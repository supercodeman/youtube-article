import { connect } from 'cloudflare:sockets';

// SOCKS5 协议实现（webshare.io 等代理常用）
// 适用场景：endpoint 实际是 SOCKS5 协议（端口 5863 等非标准 HTTP 代理端口常见）。
// 共享 withTimeout / safeStartTls / sendHttpRequest / readHttpResponse / readExactBytes from ./proxy

import type { ProxyConfig, ProxiedRequest, ProxiedResponse } from './proxy';
import {
  REQUEST_TIMEOUT_MS,
  withTimeout,
  safeStartTls,
  sendHttpRequest,
  readHttpResponse,
  readExactBytes
} from './proxy';

/**
 * 通过 SOCKS5 代理对 https:// 目标发起一次 HTTP 请求。
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

        tlsSocket = await safeStartTls(tcpSocket, targetHost);
        await sendHttpRequest(tlsSocket, req, targetHost, targetPort);
        return await readHttpResponse(tlsSocket);
      } finally {
        const toClose = tlsSocket ?? tcpSocket;
        try { await toClose.close(); } catch { /* ignore */ }
      }
    }
  );
}

/**
 * SOCKS5 握手独立测试：只跑 socks5Greet + socks5Connect，不调 startTls、不发 HTTP。
 * 用于区分"握手本身失败"和"握手成功但 startTls 失败（proxy 关 socket）"。
 */
export async function socks5ConnectOnly(
  cfg: ProxyConfig,
  targetHost: string,
  targetPort: number
): Promise<{ proxyHost: string; targetHost: string; targetPort: number }> {
  return withTimeout(
    REQUEST_TIMEOUT_MS,
    async () => {
      const tcpSocket = connect(
        { hostname: cfg.host, port: cfg.port },
        { secureTransport: 'starttls', allowHalfOpen: false }
      );
      try {
        await socks5Greet(tcpSocket, cfg);
        await socks5Connect(tcpSocket, targetHost, targetPort);
        return { proxyHost: `${cfg.host}:${cfg.port}`, targetHost, targetPort };
      } finally {
        try { await tcpSocket.close(); } catch { /* ignore */ }
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
  // 域名的 ATYP=3 会多 1+NLEN 字节，那种情况我们读多留少，剩余字节会被 startTls 当 TLS 错——
  // 实际罕见，主流 SOCKS5 实现用 IPv4 应答，可接受。
}
