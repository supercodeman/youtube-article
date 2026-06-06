# YouTube Article - 设计规格

## 概述

将 YouTube 视频字幕转换为结构化中文文章，支持流式输出、用户自定义生成要求、章节级 5W1H 总结。

## 技术栈

- **运行时**: Cloudflare Workers (TypeScript)
- **AI**: Google Gemini AI (免费 tier)
- **存储**: Cloudflare KV
- **代理**: webshare.io (TCP Socket 隧道)

## 架构

```
worker/
├── index.ts          # 入口，路由分发，日志系统
├── types.ts          # 类型定义
├── services/
│   ├── subtitle.ts   # YouTube 字幕获取 + TCP 代理
│   ├── gemini.ts     # Gemini 流式生成
│   └── storage.ts    # KV session 存储
└── utils/
    ├── parser.ts     # AI 输出解析
    └── validator.ts  # 输入校验
```

## 核心流程

### 1. 文章生成流程

```
用户提交 YouTube URL → 创建 Session → 记录日志
                          ↓
                    获取字幕 (TCP 代理)
                          ↓
                    记录日志: 字幕长度/状态
                          ↓
                    Gemini 流式生成
                          ↓
                    SSE 推送章节+文本 → 前端渲染
                          ↓
                    记录日志: 生成进度
```

### 2. 5W1H 总结流程

```
用户点击 [5W1H] → GET /api/chapter/:sessionId/:index/summary
                        ↓
              检查 session.article.fullText (服务端已有)
              检查 chapter.summary5w1h (已生成则缓存)
                        ↓
              未生成 → Gemini.generateSummary(fullText, chapterTitle, chapterContent)
                        ↓
              返回 { who, what, when, where, why, how }
```

## 功能详情

### 字幕获取 (SubtitleService)

- **TCP Socket 代理**: 使用 `connect()` API 建立到 webshare.io 的隧道
- **Fallback**: 为演示视频硬编码字幕，避免依赖 YouTube API
- **日志**: 记录代理连接状态、请求发送、响应接收

### 用户生成要求

- 可选输入，限制 500 字符
- 作为 system prompt 的一部分传给 Gemini
- 影响输出风格、受众、内容范围

### 5W1H 总结

- 每个章节独立缓存 (chapter.summary5w1h)
- 服务端基于 session.article.fullText 上下文生成
- 前端不重传全文，仅传 chapter index

### 日志系统

- **存储**: 记录到 session.logs[] 数组
- **前端展示**: 可折叠面板，默认收起
- **日志级别**: INFO, SUCCESS, ERROR
- **时间戳**: 相对时间 (距离 session 创建的秒数)
- **容量**: 最多 100 条，超出则丢弃最旧

## API 设计

| 端点 | 方法 | 功能 |
|------|------|------|
| `POST /api/generate` | 创建 session，返回 sessionId |
| `GET /api/stream/:sessionId` | SSE 流，实时输出章节和文本 |
| `GET /api/chapter/:sessionId/:index/summary` | 获取章节 5W1H 总结 |
| `GET /api/session/:sessionId` | 获取完整 session (含日志) |
| `DELETE /api/session/:sessionId` | 删除 session |
| `GET /` | 返回 HTML 页面 |

## 页面设计

```
┌──────────────────────────────────────────────────────────┐
│  YouTube 字幕转文章                            [日志]  │
├──────────────────────────────────────────────────────────┤
│  [输入框: YouTube URL                        ] [生成] │
│  [输入框: 生成要求(可选)                     ]        │
├──────────────────────────────────────────────────────────┤
│  [进度条] 状态文本                                    │
├──────────────────────────────────────────────────────────┤
│  [CHAPTER 1] 章节标题                    [5W1H]       │
│  内容...                                              │
│                                                        │
│  [CHAPTER 2] ...                                      │
├──────────────────────────────────────────────────────────┤
│ ▼ 操作日志                                     [收起]  │
│ [00:05] 开始获取字幕...                              │
│ [00:06] 代理连接成功                                 │
│ [00:07] 收到字幕: 1258 字符                          │
└──────────────────────────────────────────────────────────┘
```

## 工程取舍

1. **代理 vs 中转**: 选择 TCP Socket 而非中转服务，避免额外服务依赖
2. **硬编码 Fallback**: 演示视频预置字幕，确保演示稳定性
3. **日志存储在 Session**: 避免独立 KV key，减少复杂度
4. **5W1H 按需生成**: 仅当用户点击时生成，已生成则缓存

## 亮点

1. **流式输出**: 生成一点输出一点，用户体验流畅
2. **完整操作日志**: 用户可看到每一步状态，便于排查问题
3. **5W1H 上下文感知**: 基于整篇文章 + 章节内容生成总结
4. **TCP Socket 代理**: Cloudflare Workers 原生支持，无需第三方中转
---

# v2 变更（2026-06-06）

回头对照需求文档，发现 v1 存在三处偏离实际的命名/描述：原 spec 说"TCP Socket 代理"但代码完全没实现；类名 `GeminiService` 但调的是 MiniMax 网关；env 叫 `MINIMAX_API_KEY` 但又不是 MiniMax。本次按"对齐需求 + 补齐缺失"的目标做了重构。

## 1. 命名清理

| 旧 | 新 | 原因 |
|---|---|---|
| `GeminiService` | `LLMService` | 协议层是 OpenAI Chat Completions 兼容；类名应反映抽象层 |
| `gemini.ts` | `llm.ts` | 同上 |
| `MINIMAX_API_KEY` | `LLM_API_KEY` | env 名应描述用途而非历史出处 |
| `AI_CONFIG` | `LLM_CONFIG` | 同 LLMService |

不修改 prompt、不修改前端、不修改流式协议。

## 2. 新增 webshare.io TCP Socket 代理

### 模块结构

```
worker/services/
├── proxy.ts      # ⭐ 新增：TCP CONNECT 隧道 + TLS + HTTP/1.1 手写
├── youtube.ts    # ⭐ 新增：InnerTube + timedtext，支持有/无代理
└── subtitle.ts   # 改造：从单一 fetch 改为 4 级降级编排
```

依赖方向：`subtitle → youtube → proxy`（单向），`subtitle` 直接 import `loadProxyConfig` 决定是否传 proxy 给 youtube。

### proxy.ts 关键设计

- API：`proxiedFetch({ url, method, headers, body }, ProxyConfig)` → `Promise<{ status, headers, body }>`
- 流程：`connect({hostname, port}, {secureTransport: 'starttls'})` → 发 `CONNECT host:port HTTP/1.1` + Basic Auth → 读响应（必须严格读到 `\r\n\r\n`） → 200 OK 后调 `socket.startTls({ expectedServerHostname })` 得到 TLS socket → 在 TLS socket 上手写 HTTP/1.1 请求 → 解析响应
- **取舍**：只支持 `Content-Length` 响应（YouTube 两个端点都满足）；强制 `Connection: close` 和 `Accept-Encoding: identity`；30 秒超时；5 MB body 上限
- **CONNECT leftover 检查**：若 CONNECT 响应后附带字节，直接抛错（说明 proxy 不规范，启动 TLS 会失败）
- **资源清理**：用 `tlsSocket ?? tcpSocket` 决定关谁，避免双重 close

### youtube.ts 关键设计

- API：`fetchYouTubeSubtitles(videoId, { proxy? })` → `{ text, languageCode, isAutoGenerated }`
- 选轨优先级：`zh-CN > zh > en* > 第一个`
- XML 解析用正则（Workers 没 DOMParser），处理 5 个常见实体 + 数字字符引用
- 有 proxy 时所有 HTTP 走 `proxiedFetch`；无 proxy 时走原生 `fetch`，**用同一组业务代码两种网络模式**

### subtitle.ts 改造

`getSubtitles(videoId, manualSubtitles, env)` 现在返回 `{ subtitles, source, attempts }`：

```typescript
type SubtitleSource = 'manual' | 'youtube' | 'youtube-proxy' | 'fallback';

interface SubtitleAttempt {
  step: 'manual' | 'youtube-direct' | 'youtube-proxy' | 'fallback';
  success: boolean;
  message: string;
}
```

降级链：manual → youtube-direct → youtube-proxy（env 配了才试）→ fallback（**仅 videoId === DEMO_VIDEO_ID 时启用**，其他视频抓不到返回 null）。
每一步的成败都进 `attempts`，由 `index.ts` 调 `attemptsToLogs(attempts, createdAt)` 转成 `LogEntry[]` 塞入 `session.logs`，UI 日志面板可见。

## 3. debug 端点重构

`/api/debug/youtube?videoId=xxx` 从原来"测 youtube-transcript 包"改为：

- Test 1: 直 fetch YouTube 首页（连通性）
- Test 2: 走 `fetchYouTubeSubtitles(videoId)`（无代理，验证直拉）
- Test 3: 走 `fetchYouTubeSubtitles(videoId, { proxy })`（有代理，验证 webshare 隧道）

部署后用这个端点 + 一个真实视频 ID 就能验证两条字幕路径。

## 4. 依赖清理

`package.json` 删除：
- `@google/generative-ai`（一直没被 import 过）
- `youtube-transcript`（被新 youtube.ts 完全替代）

## 5. 类型变更

```typescript
// types.ts
- export type SubtitleSource = 'manual' | 'fallback';
+ export type SubtitleSource = 'manual' | 'youtube' | 'youtube-proxy' | 'fallback';
```

## 6. 不变的部分（保持原设计）

- HTML 前端（流式渲染、日志面板、5W1H 弹出框）
- SSE 事件协议（subtitle / chapter / text / done / error / log）
- KV session 结构与 24 小时 TTL
- parser 状态机（章节切分 + `<think>` 过滤）
- prompt 构造规则

## 工程取舍说明

- **没换 Gemini**：用户明确选择保留 MiniMax。原因是协议兼容、网关已有，且需求文档的 Gemini 措辞是"调用"而非强制硬性指标。README 已写实情声明
- **代理是可选不是必须**：4 个 PROXY_* 都不配时跳过整个 Level 3，降级到硬编码。这样本地开发不依赖 webshare 也能跑
- **chunked / gzip 不解**：复杂度收益不匹配，YouTube 两个端点不需要
- **代理超时 30s 包整个流程**：CONNECT、TLS、请求、响应一起算，简单粗暴但够用
