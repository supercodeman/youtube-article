export interface Session {
  id: string;
  videoUrl: string;
  videoId: string;
  subtitles: string;
  userRequirements: string;
  article: Article;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
}

export type SessionStatus = 'idle' | 'generating' | 'done' | 'error';

export interface Article {
  fullText: string;
  chapters: Chapter[];
}

export interface Chapter {
  index: number;
  title: string;
  startIndex: number;
  summary5w1h?: FiveW1H;
}

export interface FiveW1H {
  who: string;
  what: string;
  when: string;
  where: string;
  why: string;
  how: string;
}

export interface GenerateRequest {
  videoUrl: string;
  requirements?: string;
}

export interface GenerateResponse {
  sessionId: string;
  status: SessionStatus;
}

export interface SSEChunk {
  type: 'chapter' | 'text' | 'done' | 'error';
  index?: number;
  title?: string;
  content?: string;
  chapters?: Chapter[];
}

export interface ErrorResponse {
  code: string;
  message: string;
  fallback?: string;
}

export type ParserEvent =
  | { type: 'chapter'; index: number; title: string; startIndex: number }
  | { type: 'text'; content: string };