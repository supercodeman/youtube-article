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