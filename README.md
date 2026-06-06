# YouTube 字幕转文章

基于 Cloudflare Workers 的 AI 文章生成服务：输入 YouTube 视频链接 → 拉字幕 → LLM 流式生成中文文章 → 按章节渲染 → 每章可按需生成 5W1H 总结。

**演示视频**：https://www.youtube.com/watch?v=xRh2sVcNXQ8
**在线体验**：https://youtube-article.chenglongsang11.workers.dev

---

## 功能清单

| 需求 | 实现状态 |
|---|---|
| 输入 YouTube 链接生成中文文章 | ✅ |
| 字幕硬编码兜底（仅限 demo 视频 xRh2sVcNXQ8） | ✅ |
| 主文章流式输出（实时渲染） | ✅ SSE |
| 自然语言生成要求（影响风格/受众） | ✅ |
| 章节组织 + [5W1H] 按钮 | ✅ |
| 章节 5W1H 上下文感知（不重传全文） | ✅ KV session |
| YouTube 字幕获取（含代理绕过验证码） | ✅ webshare.io HTTP CONNECT / SOCKS5 |

---

## 快速开始

```bash
npm install
npm run dev        # 本地起 wrangler dev，访问 http://localhost:8787
npm run typecheck  # tsc --noEmit
npm run deploy     # wrangler deploy
```

## 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `MINIMAX_API_KEY` | ✅ | LLM 网关 API key（MiniMax-M2.7，via api.minimax.chat） |
| `PROXY_HOST` | 可选 | webshare.io 代理 host |
| `PROXY_PORT` | 可选 | webshare.io 代理 port |
| `PROXY_USERNAME` | 可选 | webshare.io 代理用户名 |
| `PROXY_PASSWORD` | 可选 | webshare.io 代理密码 |

部署时用 `wrangler secret put VAR_NAME` 注入；本地开发用 `.dev.vars` 文件（gitignore 已忽略）。
4 个 PROXY_* 都不配时跳过代理，**非 demo 视频**字幕抓不到会返回错误并提示用户手动粘贴（避免用 demo 字幕糊弄非 demo 视频）。

## API 端点

| 路径 | 方法 | 说明 |
|---|---|---|
| `/` | GET | 返回 HTML 页面 |
| `/api/generate` | POST | 创建 session：拉字幕，返回 sessionId |
| `/api/stream/:sessionId` | GET | SSE 流，实时推送章节和文本 |
| `/api/chapter/:sessionId/:index/summary` | GET | 按需生成单个章节 5W1H |
| `/api/session/:sessionId` | GET / DELETE | 查询 / 删除 session |
| `/api/debug/youtube?videoId=xxx` | GET | 诊断端点：测直拉 + 两种代理协议 |

---

## 工程实现说明

### 1. 如何获取和处理 YouTube 字幕

**四级降级链**，但 Level 4 仅对 demo 视频 `xRh2sVcNXQ8` 生效——避免用 demo 字幕糊弄其他视频导致 LLM 生成与实际视频无关的文章：

```
manualSubtitles → youtube 直拉 → youtube 走 webshare 代理 → （仅 demo 视频）硬编码 demo
```

- **Level 1 manual**：用户从 YouTube 转录稿复制粘贴，最快最准零依赖
- **Level 2 直拉**：Worker 出口 IP 直接 POST 到 `https://www.youtube.com/youtubei/v1/player`（Android 客户端上下文）→ 拿 `captionTracks[i].baseUrl` → GET 拿 XML → 解析。**支持 `format="1"` (`<text start dur>`) 和 `format="3"` (`<p t d>` 毫秒) 两种 YouTube 字幕轨格式**
- **Level 3 代理重试**：直拉被 YouTube 风控/验证码时启用。**Cloudflare Workers 的 `fetch()` 不支持代理**，所以走 `cloudflare:sockets` 的 `connect()` 建 TCP socket → 发 `CONNECT host:443 HTTP/1.1` 走 HTTP CONNECT 隧道（Basic Auth）→ `socket.startTls()` 升级 TLS → 在 socket 上手写 HTTP/1.1 请求与响应解析。也支持 **SOCKS5** 协议（不同 endpoint 协议类型不同时切换）
- **Level 4 fallback**：仅 `videoId === 'xRh2sVcNXQ8'` 时返回硬编码 demo 字幕

每级尝试结果进 `session.logs`，前端日志面板可见全过程。

### 2. 如何调用 LLM 并实现流式输出

> **关于 LLM 选型**：需求文档建议 Gemini AI Studio，本项目实际接 **MiniMax-M2.7**（via `api.minimax.chat` 网关）。两者协议层都是 OpenAI Chat Completions 兼容，切换只需改 `LLM_CONFIG.baseUrl` 和 `model`。选 MiniMax 是因为出题方已经提供该网关。

**流式实现路径**：
```
LLMService.generateStream()
  → fetch /v1/chat/completions { stream: true }
  → ReadableStream reader 逐 chunk 读
  → split('\n')，识别 'data: {...}' 行
  → 取 delta.content，yield SSEChunk { type: 'text', content }
```

Worker 用 `ReadableStream` + `controller.enqueue()` 把每个 chunk 包成 SSE 事件（`event: text\ndata: {...}\n\n`），前端 `EventSource` 接收实时渲染。

**章节切分发生在流上**：parser 状态机维护 buffer，扫到 `[CHAPTER N: 标题]` 时切出 `chapter` 事件，其余文本作为 `text` 事件追加到当前章节。同步过滤模型可能输出的 `<think>` 块。

### 3. 如何根据用户生成要求影响输出结果

前端"生成要求"输入框（限 500 字符，超长截断）。后端在 `buildArticlePrompt` 时把它作为 `【用户要求】` 段拼到 prompt 末尾：

```
【视频字幕】
...
【用户要求】
{requirements}
【输出格式 - 严格遵守】
- 请分为 N 个章节
- 必须使用 [CHAPTER N: 标题] 标记
- 章节内容使用对话排版
...
```

模型在生成时综合考虑 **字幕内容 + 用户要求 + 输出格式约束**。需求允许"任务类型/输出风格/目标受众/约束条件"等自然语言描述，模型自行理解。

### 4. 如何实现章节级 5W1H 总结

**关键约束**：前端点 `[5W1H]` 时**不重传整篇文章**，仅传 `chapterIndex`。所有上下文由服务端从 KV session 里取。

**流程**：
```
用户点 [5W1H]
  → GET /api/chapter/:sessionId/:index/summary
  → 服务端从 KV 取 session.article.fullText 和 chapters[index]
  → 用 chapter.startIndex 切出该章节文本
  → 已缓存（chapter.summary5w1h）→ 直接返回
  → 未缓存 → 调 LLMService.generateSummary(fullText, chapterTitle, chapterContent)
  → prompt 要求严格返回 {who, what, when, where, why, how} JSON
  → 平衡大括号扫描解析 + 字段校验 → 写回 chapter.summary5w1h（KV 缓存）→ 返回
```

5W1H 用"**整篇 + 该章节**"双上下文输入，所以模型既能抓住章节细节，也不丢失整体语境。

---

## 技术架构

```
worker/
├── index.ts                # 路由分发 + SSE 编排 + HTML 内联
├── config.ts               # Env 接口 + LLM/Session 常量
├── types.ts                # Domain / API / SSE 类型
├── static-html.ts          # 内联的前端 HTML/CSS/JS
└── services/
    ├── subtitle.ts         # 字幕编排层（4 级降级 + 操作日志）
    ├── youtube.ts          # InnerTube API + timedtext，支持有/无代理
    ├── proxy.ts            # ⭐ HTTP CONNECT 隧道 + TLS + 手写 HTTP/1.1
    ├── proxy-socks5.ts     # ⭐ SOCKS5 协议实现
    ├── llm.ts              # OpenAI 兼容 Chat Completions 客户端（流 / 非流）
    └── storage.ts          # KV session CRUD
└── utils/
    ├── parser.ts           # 章节标记 + <think> 块过滤的流式解析器
    ├── prompt.ts           # Article / Summary prompt 构造
    └── validator.ts        # YouTube URL / UUID / 输入清理
```

模块边界靠**单向依赖**：utils 不依赖 services；services 之间只能上层调下层（`subtitle → youtube → proxy`）；`index.ts` 是顶层编排。

---

## 主要工程取舍 & 亮点

**取舍**：

1. **LLM 选 MiniMax 而非 Gemini**：协议兼容、网关已有，切换成本一行配置
2. **代理只解 Content-Length，不解 chunked / gzip**：YouTube InnerTube 和 timedtext 响应都带 Content-Length，强制 `Accept-Encoding: identity` 跳 gzip，节省 200+ 行 HTTP 状态机
3. **session 日志限 100 条、TTL 24 小时**：避免 KV 配额浪费
4. **fallback 仅限 demo 视频**：保证 demo 永远可用，但非 demo 视频严格按真实链接抓（不糊弄）

**亮点**：

1. **TCP Socket + 手写 HTTPS**：演示 Cloudflare Workers 原生 socket API 的实战用法（HTTP CONNECT 隧道 + SOCKS5 两种协议都支持），绕过 `fetch()` 的代理限制
2. **字幕 4 级降级链**：从手动粘贴到硬编码 demo 全场景覆盖
3. **流式章节切分**：模型边生成边切章，前端边接收边渲染，无需等全文
4. **5W1H 上下文感知**：整篇 + 章节双输入，KV 缓存避免重复生成
5. **操作日志面板**：每一步状态对用户可见，部署/排障/演示都方便
6. **YouTube 字幕轨格式自适应**：同时支持老 `format="1"` (`<text>`) 和新 `format="3"` (`<p>` 毫秒时间戳)

---

## 已知问题 & 后续可扩展

- 代理只在配置 `PROXY_*` env 后启用；webshare.io 免费 IP 池共享，对部分视频可能仍被风控
- 代理协议层只实现了 Content-Length，没做 chunked encoding 解析（YouTube 不需要）
- 未做并发限流；高并发下 KV 写可能撞上 Cloudflare 配额
- 没写单元测试（项目性质决定 ROI 低，靠 `/api/debug/youtube` 诊断端点 + 操作日志面板手测）
