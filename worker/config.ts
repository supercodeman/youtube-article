export interface Env {
  MINIMAX_API_KEY: string;
  KV_BINDING: KVNamespace;
}

// AI 模型配置
export const AI_CONFIG = {
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

// 提示词
export const SYSTEM_PROMPTS = {
  article: '你是一个专业的视频内容分析师。请根据提供的视频字幕，生成一篇结构清晰、排版精美的中文文章。',
  summary: '你是一个专业的内容分析师。请基于整篇文章和指定章节内容，生成 5W1H 结构化总结。'
};