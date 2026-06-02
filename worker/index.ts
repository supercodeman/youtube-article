import type { Session, SSEChunk, GenerateRequest, ErrorResponse } from './types';
import { SubtitleService } from './services/subtitle';
import { GeminiService } from './services/gemini';
import { StorageService } from './services/storage';
import { parseChunk, createParserState } from './utils/parser';
import {
  isValidYouTubeUrl,
  isValidUUID,
  sanitizeRequirements,
  extractVideoId
} from './utils/validator';

interface Env {
  GEMINI_API_KEY: string;
  ARTICLE_KV: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    try {
      if (path === '/api/generate' && request.method === 'POST') {
        return await handleGenerate(request, env);
      }
      if (path.startsWith('/api/stream/') && request.method === 'GET') {
        return await handleStream(request, env);
      }
      if (path.startsWith('/api/chapter/') && request.method === 'GET') {
        return await handleChapterSummary(request, env);
      }
      if (path.startsWith('/api/session/') && request.method === 'GET') {
        return await handleGetSession(request, env);
      }
      if (path.startsWith('/api/session/') && request.method === 'DELETE') {
        return await handleDeleteSession(request, env);
      }
      if (path === '/' || path === '/index.html') {
        const html = await fetch(new Request('public/index.html')).then(r => r.text());
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return jsonError((e as Error).message);
    }
  }
};

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as GenerateRequest;

  if (!isValidYouTubeUrl(body.videoUrl)) {
    return jsonError('Invalid YouTube URL', 'INVALID_URL');
  }

  const videoId = extractVideoId(body.videoUrl);
  const requirements = sanitizeRequirements(body.requirements);

  const sessionId = crypto.randomUUID();
  const session: Session = {
    id: sessionId,
    videoUrl: body.videoUrl,
    videoId,
    subtitles: '',
    userRequirements: requirements,
    article: { fullText: '', chapters: [] },
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const storage = new StorageService(env.ARTICLE_KV);
  await storage.saveSession(session);

  return json({ sessionId, status: 'generating' });
}

async function handleStream(request: Request, env: Env): Promise<Response> {
  const sessionId = extractSessionId(request.url);
  const storage = new StorageService(env.ARTICLE_KV);
  const session = await storage.getSession(sessionId);

  if (!session) {
    return jsonError('Session not found', 'SESSION_NOT_FOUND');
  }

  await storage.updateStatus(sessionId, 'generating');

  const subtitleService = new SubtitleService(session.videoId);
  const { subtitles } = await subtitleService.fetchSubtitles();
  session.subtitles = subtitles;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const gemini = new GeminiService(env.GEMINI_API_KEY);
      const parserState = createParserState();
      let fullText = '';

      const send = (data: SSEChunk) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        for await (const chunk of gemini.generateStream(subtitles, session.userRequirements)) {
          if (chunk.type === 'text' && chunk.content) {
            const { events } = parseChunk(chunk.content, parserState);

            for (const event of events) {
              if (event.type === 'chapter') {
                session.article.chapters.push({
                  index: event.index,
                  title: event.title,
                  startIndex: fullText.length
                });
                send({ type: 'chapter', index: event.index, title: event.title });
              } else if (event.type === 'text') {
                fullText += event.content;
                send({ type: 'text', content: event.content });
              }
            }
          }
        }

        session.article.fullText = fullText;
        session.status = 'done';
        await storage.saveSession(session);
        send({ type: 'done', chapters: session.article.chapters });

      } catch (e) {
        session.status = 'error';
        await storage.saveSession(session);
        send({ type: 'error', content: (e as Error).message } as SSEChunk);
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

async function handleChapterSummary(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const sessionId = parts[parts.length - 2];
  const chapterIndex = parseInt(parts[parts.length - 1], 10);

  if (!isValidUUID(sessionId) || isNaN(chapterIndex)) {
    return jsonError('Invalid parameters', 'INVALID_PARAMS');
  }

  const storage = new StorageService(env.ARTICLE_KV);
  const session = await storage.getSession(sessionId);

  if (!session) {
    return jsonError('Session not found', 'SESSION_NOT_FOUND');
  }

  const chapter = session.article.chapters.find(c => c.index === chapterIndex);
  if (!chapter) {
    return jsonError('Chapter not found', 'CHAPTER_NOT_FOUND');
  }

  if (chapter.summary5w1h) {
    return json(chapter.summary5w1h);
  }

  const gemini = new GeminiService(env.GEMINI_API_KEY);
  const chapterContent = extractChapterContent(session.article.fullText, chapter, session.article.chapters);
  const summary = await gemini.generateSummary(
    session.article.fullText,
    chapter.title,
    chapterContent
  );

  await storage.save5w1h(sessionId, chapterIndex, summary);
  return json(summary);
}

async function handleGetSession(request: Request, env: Env): Promise<Response> {
  const sessionId = extractSessionId(request.url);
  const storage = new StorageService(env.ARTICLE_KV);
  const session = await storage.getSession(sessionId);

  if (!session) {
    return jsonError('Session not found', 'SESSION_NOT_FOUND');
  }

  return json(session);
}

async function handleDeleteSession(request: Request, env: Env): Promise<Response> {
  const sessionId = extractSessionId(request.url);
  const storage = new StorageService(env.ARTICLE_KV);
  await storage.deleteSession(sessionId);
  return json({ success: true });
}

function extractSessionId(url: string): string {
  const parts = new URL(url).pathname.split('/');
  return parts[parts.length - 1];
}

function extractChapterContent(
  fullText: string,
  chapter: { index: number; startIndex: number },
  chapters: { index: number; startIndex: number }[]
): string {
  const nextChapter = chapters.find(c => c.index === chapter.index + 1);
  const endIndex = nextChapter ? nextChapter.startIndex : fullText.length;
  return fullText.slice(chapter.startIndex, endIndex);
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function jsonError(message: string, code = 'ERROR'): Response {
  const error: ErrorResponse = { code, message };
  return new Response(JSON.stringify(error), {
    status: 400,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
