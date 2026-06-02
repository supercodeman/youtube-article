# YouTube 字幕转文章

基于 Cloudflare Workers 的 AI 文章生成服务，将 YouTube 视频字幕转换为结构化中文文章。

## 功能特性

- **流式输出**: 生成一点输出一点，实时展示在网页上
- **用户生成要求**: 支持输入自然语言描述影响输出风格
- **章节组织**: 文章按章节组织，每个章节支持 5W1H 总结
- **操作日志**: 可折叠日志面板，展示每一步操作状态
- **硬编码 Fallback**: 演示视频预置字幕，避免依赖 YouTube API

## 快速开始

### 本地开发

```bash
npm install
npm run dev
```

访问 http://localhost:8787

### 部署

```bash
npm run deploy
```

## 环境变量

| 变量 | 说明 | 必需 |
|------|------|------|
| `MINIMAX_API_KEY` | MiniMax API 密钥 | 是 |
| `PROXY_HOST` | 代理服务器地址 | 否 |
| `PROXY_PORT` | 代理服务器端口 | 否 |
| `PROXY_USERNAME` | 代理认证用户名 | 否 |
| `PROXY_PASSWORD` | 代理认证密码 | 否 |

## API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `POST /api/generate` | 创建 session，返回 sessionId | 启动文章生成 |
| `GET /api/stream/:sessionId` | SSE 流 | 实时输出章节和文本 |
| `GET /api/chapter/:sessionId/:index/summary` | 获取章节 5W1H 总结 | |
| `GET /api/session/:sessionId` | 获取完整 session (含日志) | |
| `DELETE /api/session/:sessionId` | 删除 session | |
| `GET /` | 返回 HTML 页面 | |

## 技术架构

```
worker/
├── index.ts          # 入口，路由分发，日志系统
├── types.ts          # 类型定义
├── services/
│   ├── subtitle.ts   # YouTube 字幕获取
│   ├── gemini.ts     # MiniMax 流式生成
│   └── storage.ts    # KV session 存储
└── utils/
    ├── parser.ts     # AI 输出解析
    └── validator.ts  # 输入校验
```

## 主要工程取舍

1. **TCP Socket 代理**: Cloudflare Workers 支持 `connect()` API，可建立 TCP 隧道绕过 YouTube 验证码
2. **硬编码 Fallback**: 演示视频预置字幕，确保演示稳定性
3. **日志存储在 Session**: 避免独立 KV key，减少复杂度
4. **5W1H 按需生成**: 仅当用户点击时生成，已生成则缓存

## 亮点

1. **流式输出**: 生成一点输出一点，用户体验流畅
2. **完整操作日志**: 用户可看到每一步状态，便于排查问题
3. **5W1H 上下文感知**: 基于整篇文章 + 章节内容生成总结
4. **Server-Sent Events**: 高效的实时通信机制

## 演示视频

https://www.youtube.com/watch?v=xRh2sVcNXQ8