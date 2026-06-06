export interface Env {
  // LLM 凭据：实际接 MiniMax-M2.7（OpenAI 兼容协议，via api.minimax.chat 网关）
  // 需求文档原写"Gemini AI Studio"，实际采用 MiniMax 是因为出题人的 AI 网关已经提供，
  // 节省了 Gemini 注册/限流环节。两者协议层都是 OpenAI Chat Completions，切换只需改 baseUrl + model。
  MINIMAX_API_KEY: string;

  // 可选：webshare.io HTTP 代理，绕过 YouTube 对 Cloudflare Worker 出口 IP 的风控。
  // 未配置则 subtitle.ts 会跳过代理重试，降级到硬编码字幕兜底。
  PROXY_HOST?: string;
  PROXY_PORT?: string;
  PROXY_USERNAME?: string;
  PROXY_PASSWORD?: string;

  KV_BINDING: KVNamespace;
}

// LLM 网关配置（OpenAI Chat Completions 兼容）
export const LLM_CONFIG = {
  baseUrl: 'https://api.minimax.chat/v1',
  model: 'MiniMax-M2.7',
  maxTokens: 4000
};

// Session 存储配置
export const SESSION_CONFIG = {
  ttl: 86400, // 24 小时
  prefix: 'session:'
};

// 用户输入限制
export const INPUT_LIMITS = {
  requirements: 500,
  manualSubtitles: 5000
};

// 提示词角色定义
export const SYSTEM_PROMPTS = {
  article: '你是一个专业的视频内容分析师。请根据提供的视频字幕，生成一篇结构清晰、排版精美的中文文章。',
  summary: '你是一个专业的内容分析师。请基于整篇文章和指定章节内容，生成 5W1H 结构化总结。'
};
