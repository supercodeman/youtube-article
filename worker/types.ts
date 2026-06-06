// ====== Domain Types ======

export type SessionStatus = 'idle' | 'generating' | 'done' | 'error';
export type SubtitleSource = 'manual' | 'fallback';

export interface LogEntry {
  timestamp: number;
  level: 'INFO' | 'SUCCESS' | 'ERROR';
  message: string;
}

export interface FiveW1H {
  who: string;
  what: string;
  when: string;
  where: string;
  why: string;
  how: string;
}

export interface Chapter {
  index: number;
  title: string;
  startIndex: number;
  summary5w1h?: FiveW1H;
}

export interface Article {
  fullText: string;
  chapters: Chapter[];
}

export interface Session {
  id: string;
  videoUrl: string;
  videoId: string;
  subtitles: string;
  subtitleSource: SubtitleSource;
  userRequirements: string;
  article: Article;
  status: SessionStatus;
  logs: LogEntry[];
  createdAt: number;
  updatedAt: number;
}

// ====== API Types ======

export interface GenerateRequest {
  videoUrl: string;
  requirements?: string;
  manualSubtitles?: string; // 用户手动粘贴的字幕
}

export interface GenerateResponse {
  sessionId: string;
  status: SessionStatus;
  subtitleSource: SubtitleSource;
}

export interface ErrorResponse {
  code: string;
  message: string;
}

// ====== SSE Event Types ======

export type SSEEventType = 'chapter' | 'text' | 'done' | 'error' | 'subtitle' | 'log';

export interface SSEChunk {
  type: SSEEventType;
  // chapter
  index?: number;
  title?: string;
  // text
  content?: string;
  // done
  chapters?: Chapter[];
  // subtitle
  source?: SubtitleSource;
  charCount?: number;
  // log
  level?: 'INFO' | 'SUCCESS' | 'ERROR';
  message?: string;
}

// ====== Parser Types ======

export type ParserEvent =
  | { type: 'chapter'; index: number; title: string; startIndex: number }
  | { type: 'text'; content: string };