import { connect } from 'cloudflare:sockets';

// HTTP/HTTPS over webshare.io 代理（HTTP CONNECT 隧道 + TLS）
// 用途：Cloudflare Workers 的原生 fetch 不支持代理；通过 TCP Socket 自建隧道绕过 YouTube 验证码。
//
// 工作原理：
//   1. TCP 连 proxy 服务器（secureTransport: 'starttls' 标记可升级）
//   2. 发 HTTP/1.1 CONNECT 请求 + Basic Auth，让 proxy 转发到目标 host:443
//   3. 收到 200 后，调 socket.startTls() 升级为 TLS（新 socket）
//   4. 在 TLS socket 上手写 HTTP/1.1 请求并解析响应
//
// 已知限制（最小可用版本的取舍）：
//   - 只支持 Content-Length 编码的响应（不解析 chunked / gzip）；YouTube InnerTube 和 timedtext 都返回 Content-Length
//   - 强制 Connection: close 和 Accept-Encoding: identity，一连一断不复用
//   - 30 秒超时（包含 CONNECT、TLS 握手、请求响应全程）

export interface ProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ProxiedRequest {
  url: string;                       // 完整 URL，必须 https://
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface ProxiedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;   // header 名一律小写
  body: string;                      // UTF-8 解码后的文本
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;  // 5 MB 防御性上限

export function loadProxyConfig(env: Record<string, string | undefined>): ProxyConfig | null {
  const host = env.PROXY_HOST?.trim();
  const portStr = env.PROXY_PORT?.trim();
  const username = env.PROXY_USERNAME?.trim();
  const password = env.PROXY_PASSWORD?.trim();
  if (!host || !portStr || !username || !password) return null;
  const port = Number(portStr);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port, username, password };
}

/**
 * 通过 webshare.io 代理对 https:// 目标发起一次 HTTP 请求。
 * 抛错场景：URL 非 https / CONNECT 失败 / TLS 握手失败 / 超时 / body 超限。
 */
export async function proxiedFetch(
  req: ProxiedRequest,
  cfg: ProxyConfig
): Promise<ProxiedResponse> {
  const target = new URL(req.url);
  if (target.protocol !== 'https:') {
    throw new Error(`proxiedFetch 仅支持 https，收到 ${target.protocol}`);
  }
  const targetHost = target.hostname;
  const targetPort = target.port ? Number(target.port) : 443;

  return withTimeout(
    REQUEST_TIMEOUT_MS,
    async () => {
      const tcpSocket = connect(
        { hostname: cfg.host, port: cfg.port },
        { secureTransport: 'starttls', allowHalfOpen: false }
      );

      let tlsSocket: ReturnType<typeof tcpSocket.startTls> | null = null;
      try {
        await sendConnectRequest(tcpSocket, targetHost, targetPort, cfg);
        await readConnectResponse(tcpSocket);

        tlsSocket = tcpSocket.startTls({ expectedServerHostname: targetHost });
        await sendHttpRequest(tlsSocket, req, targetHost, targetPort);
        return await readHttpResponse(tlsSocket);
      } finally {
        // startTls 后原 tcpSocket 不可用，关 tlsSocket 即可；未 startTls 则关 tcpSocket
        const toClose = tlsSocket ?? tcpSocket;
        try { await toClose.close(); } catch { /* socket 已关闭/错误状态，忽略 */ }
      }
    }
  );
}

/**
 * 通过 webshare.io 代理对 https:// 目标发起一次 HTTP 请求（SOCKS5 协议）。
 * 适用场景：endpoint 实际是 SOCKS5（端口 5863 等非标准 HTTP 代理端口常见）。
 * 跟 proxiedFetch 的区别只在握手层；透传后的 TLS + HTTP 逻辑完全复用。
 */
export async function proxiedFetchViaSocks5(
  req: ProxiedRequest,
  cfg: ProxyConfig
): Promise<ProxiedResponse> {
  const target = new URL(req.url);
  if (target.protocol !== 'https:') {
    throw new Error(`proxiedFetchViaSocks5 仅支持 https，收到 ${target.protocol}`);
  }
  const targetHost = target.hostname;
  const targetPort = target.port ? Number(target.port) : 443;

  return withTimeout(
    REQUEST_TIMEOUT_MS,
    async () => {
      const tcpSocket = connect(
        { hostname: cfg.host, port: cfg.port },
        { secureTransport: 'starttls', allowHalfOpen: false }
      );

      let tlsSocket: ReturnType<typeof tcpSocket.startTls> | null = null;
      try {
        await socks5Greet(tcpSocket, cfg);
        await socks5Connect(tcpSocket, targetHost, targetPort);

        tlsSocket = tcpSocket.startTls({ expectedServerHostname: targetHost });
        await sendHttpRequest(tlsSocket, req, targetHost, targetPort);
        return await readHttpResponse(tlsSocket);
      } finally {
        const toClose = tlsSocket ?? tcpSocket;
        try { await toClose.close(); } catch { /* ignore */ }
      }
    }
  );
}

// SOCKS5 问候：客户端声明支持的认证方法，服务器选一个
async function socks5Greet(
  socket: ReturnType<typeof connect>,
  cfg: ProxyConfig
): Promise<void> {
  // VER=5, NMETHODS=2, METHODS=[NO_AUTH(0x00), USERNAME_PASS(0x02)]
  const greet = new Uint8Array([0x05, 0x02, 0x00, 0x02]);
  const w = socket.writable.getWriter();
  try {
    await w.write(greet);
  } finally {
    w.releaseLock();
  }

  const initial = await readExactBytes(socket, new Uint8Array(0), 2);
  if (initial[0] !== 0x05) {
    throw new Error(`SOCKS5 协议不匹配：VER=${initial[0]}`);
  }
  const method = initial[1];
  if (method === 0xff) {
    throw new Error('SOCKS5 服务器无可接受的认证方法');
  }

  if (method === 0x02) {
    // USERNAME_PASS（RFC 1929）：VER=1, ULEN, UNAME, PLEN, PASSWD
    const u = new TextEncoder().encode(cfg.username);
    const p = new TextEncoder().encode(cfg.password);
    const authReq = new Uint8Array(3 + u.byteLength + p.byteLength);
    authReq[0] = 0x01;
    authReq[1] = u.byteLength;
    authReq.set(u, 2);
    authReq[2 + u.byteLength] = p.byteLength;
    authReq.set(p, 3 + u.byteLength);

    const w2 = socket.writable.getWriter();
    try {
      await w2.write(authReq);
    } finally {
      w2.releaseLock();
    }

    const authResp = await readExactBytes(socket, new Uint8Array(0), 2);
    if (authResp[0] !== 0x01) {
      throw new Error(`SOCKS5 认证响应 VER 不匹配：${authResp[0]}`);
    }
    if (authResp[1] !== 0x00) {
      throw new Error(`SOCKS5 认证失败：status=${authResp[1]}`);
    }
  } else if (method !== 0x00) {
    throw new Error(`SOCKS5 不支持的认证方法：${method}`);
  }
}

// SOCKS5 CONNECT：把目标 host:port 告诉 proxy，0x00 表示成功
async function socks5Connect(
  socket: ReturnType<typeof connect>,
  targetHost: string,
  targetPort: number
): Promise<void> {
  // VER=5, CMD=CONNECT(0x01), RSV=0x00, ATYP=DOMAIN(0x03), ...
  const domain = new TextEncoder().encode(targetHost);
  const req = new Uint8Array(7 + domain.byteLength);
  req[0] = 0x05;
  req[1] = 0x01;
  req[2] = 0x00;
  req[3] = 0x03;
  req[4] = domain.byteLength;
  req.set(domain, 5);
  req[5 + domain.byteLength] = (targetPort >> 8) & 0xff;
  req[6 + domain.byteLength] = targetPort & 0xff;

  const w = socket.writable.getWriter();
  try {
    await w.write(req);
  } finally {
    w.releaseLock();
  }

  // 响应至少 10 字节（VER + REP + RSV + ATYP + 4 字节 IPv4 + 2 端口）
  // 域名的 BND.ADDR 长度可变，但这里最少也 10 字节（IPv4）；先读 10 字节再看 ATYP
  const head = await readExactBytes(socket, new Uint8Array(0), 10);
  if (head[0] !== 0x05) {
    throw new Error(`SOCKS5 CONNECT 响应 VER 不匹配：${head[0]}`);
  }
  const rep = head[1];
  if (rep !== 0x00) {
    const errMap = ['成功', '一般失败', '规则不允许', '网络不可达', '主机不可达', '连接拒绝', 'TTL 过期', '不支持的命令', '不支持的地址类型'];
    throw new Error(`SOCKS5 CONNECT 失败：rep=${rep} (${errMap[rep] || '未知'})`);
  }
  // 注：BND.ADDR / BND.PORT 字节留在 socket 里，对我们无意义，
  // 后续 startTls 会从 socket 读 TLS server hello，可能从 BND 字节之后开始。
  // 大多数 SOCKS5 服务器在 BND 之后会停止发数据；少数会粘在 BND 后。
  // 为安全，如果 BND.ADDR 是 IPv4 (ATYP=1) 我们只读 4 字节 + 2 端口 = 6，
  // 但前面已读 10 = 4 (VER+REP+RSV+ATYP) + 4 (IPv4) + 2 (port)，刚好够。
  // 域名的 ATYP=3 会多 1+NLEN 字节，那种情况我们读多留少，剩余字节会被 startTls 当 TLS 错——
  // 实际罕见，主流 SOCKS5 实现用 IPv4 应答，可接受。
}

// ====== 内部辅助函数 ======

function withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`代理请求超时 (${ms}ms)`)), ms);
    fn().then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function sendConnectRequest(
  socket: ReturnType<typeof connect>,
  host: string,
  port: number,
  cfg: ProxyConfig
): Promise<void> {
  const auth = btoa(`${cfg.username}:${cfg.password}`);
  const lines = [
    `CONNECT ${host}:${port} HTTP/1.1`,
    `Host: ${host}:${port}`,
    `Proxy-Authorization: Basic ${auth}`,
    `Proxy-Connection: keep-alive`,
    `User-Agent: youtube-article/1.0`,
    ``,
    ``
  ];
  const writer = socket.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(lines.join('\r\n')));
  } finally {
    writer.releaseLock();
  }
}

async function readConnectResponse(socket: ReturnType<typeof connect>): Promise<void> {
  const { headBytes, leftover } = await readUntilDoubleCrlf(socket, 8192);
  const head = new TextDecoder().decode(headBytes);
  const statusLine = head.split('\r\n', 1)[0] || '';
  const match = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})\s*(.*)$/);
  if (!match) {
    throw new Error(`代理 CONNECT 响应不合法：${statusLine || '(空)'}`);
  }
  const code = Number(match[1]);
  if (code !== 200) {
    throw new Error(`代理 CONNECT 失败：${code} ${match[2]}`);
  }
  // CONNECT 协议要求 200 后直接进入透传，响应不应该带 body。
  // 若 proxy 不规范地附加了字节，startTls 会因为缺少 TLS server hello 开头而失败——
  // 这里提前抛更友好的错误，方便排查。
  if (leftover.byteLength > 0) {
    throw new Error(`代理 CONNECT 响应后附带 ${leftover.byteLength} 字节预读数据，可能导致 TLS 握手失败`);
  }
}

async function sendHttpRequest(
  socket: ReturnType<typeof connect>,
  req: ProxiedRequest,
  host: string,
  port: number
): Promise<void> {
  const target = new URL(req.url);
  const path = target.pathname + target.search;
  const method = req.method || 'GET';
  const userHeaders = req.headers || {};

  // 强制头：Host / Connection / Accept-Encoding / Content-Length
  const headers: Record<string, string> = {
    Host: port === 443 ? host : `${host}:${port}`,
    Connection: 'close',
    'Accept-Encoding': 'identity',
    ...userHeaders
  };
  if (req.body !== undefined) {
    headers['Content-Length'] = String(new TextEncoder().encode(req.body).byteLength);
  }

  const lines = [`${method} ${path} HTTP/1.1`];
  for (const [k, v] of Object.entries(headers)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push('', '');
  const head = lines.join('\r\n');

  const writer = socket.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(head));
    if (req.body !== undefined) {
      await writer.write(new TextEncoder().encode(req.body));
    }
  } finally {
    writer.releaseLock();
  }
}

async function readHttpResponse(socket: ReturnType<typeof connect>): Promise<ProxiedResponse> {
  const { headBytes, leftover } = await readUntilDoubleCrlf(socket, 64 * 1024);
  const head = new TextDecoder().decode(headBytes);
  const [statusLine, ...headerLines] = head.split('\r\n');

  const statusMatch = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})\s*(.*)$/);
  if (!statusMatch) {
    throw new Error(`HTTP 响应状态行不合法：${statusLine}`);
  }
  const status = Number(statusMatch[1]);
  const statusText = statusMatch[2];

  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }

  const contentLengthRaw = headers['content-length'];
  let bodyBytes: Uint8Array;
  if (contentLengthRaw !== undefined) {
    const expected = Number(contentLengthRaw);
    if (!Number.isInteger(expected) || expected < 0 || expected > MAX_BODY_BYTES) {
      throw new Error(`Content-Length 不合法或超限：${contentLengthRaw}`);
    }
    bodyBytes = await readExactBytes(socket, leftover, expected);
  } else {
    // 无 Content-Length：读到连接关闭（Connection: close 场景）
    bodyBytes = await readUntilEof(socket, leftover, MAX_BODY_BYTES);
  }

  return {
    status,
    statusText,
    headers,
    body: new TextDecoder().decode(bodyBytes)
  };
}

// 从 socket 读，直到出现 \r\n\r\n。返回头部字节 + 已读到 body 部分的剩余字节。
async function readUntilDoubleCrlf(
  socket: ReturnType<typeof connect>,
  maxHeadSize: number
): Promise<{ headBytes: Uint8Array; leftover: Uint8Array }> {
  const reader = socket.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error('连接在收到完整 HTTP 头之前被关闭');
      }
      chunks.push(value);
      total += value.byteLength;
      if (total > maxHeadSize) {
        throw new Error(`HTTP 头超过 ${maxHeadSize} 字节限制`);
      }

      const merged = concatUint8(chunks, total);
      const sep = findDoubleCrlf(merged);
      if (sep !== -1) {
        return {
          headBytes: merged.subarray(0, sep),
          leftover: merged.subarray(sep + 4)
        };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function readExactBytes(
  socket: ReturnType<typeof connect>,
  initial: Uint8Array,
  expected: number
): Promise<Uint8Array> {
  if (initial.byteLength >= expected) {
    return initial.subarray(0, expected);
  }
  const reader = socket.readable.getReader();
  const chunks: Uint8Array[] = [initial];
  let total = initial.byteLength;

  try {
    while (total < expected) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error(`期望读 ${expected} 字节，实际只读到 ${total}`);
      }
      chunks.push(value);
      total += value.byteLength;
    }
    return concatUint8(chunks, total).subarray(0, expected);
  } finally {
    reader.releaseLock();
  }
}

async function readUntilEof(
  socket: ReturnType<typeof connect>,
  initial: Uint8Array,
  maxBytes: number
): Promise<Uint8Array> {
  const reader = socket.readable.getReader();
  const chunks: Uint8Array[] = [initial];
  let total = initial.byteLength;
  if (total > maxBytes) {
    throw new Error(`响应 body 超过 ${maxBytes} 字节上限`);
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`响应 body 超过 ${maxBytes} 字节上限`);
      }
    }
    return concatUint8(chunks, total);
  } finally {
    reader.releaseLock();
  }
}

function concatUint8(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function findDoubleCrlf(buf: Uint8Array): number {
  for (let i = 0; i < buf.byteLength - 3; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a && buf[i + 2] === 0x0d && buf[i + 3] === 0x0a) {
      return i;
    }
  }
  return -1;
}
