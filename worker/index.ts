import type { Env } from './config';
import { INPUT_LIMITS } from './config';
import type { Session, LogEntry, SSEChunk, GenerateRequest, Chapter } from './types';
import { getSubtitles, attemptsToLogs } from './services/subtitle';
import { fetchYouTubeSubtitles } from './services/youtube';
import { loadProxyConfig } from './services/proxy';
import { LLMService } from './services/llm';
import { StorageService } from './services/storage';
import { parseChunk, createParserState, flushBuffer } from './utils/parser';
import { isValidYouTubeUrl, isValidUUID, sanitizeRequirements, extractVideoId } from './utils/validator';
import { HTML_CONTENT } from './static-html';


// ====== Utility ======

function createLog(level: LogEntry['level'], message: string, createdAt: number): LogEntry {
  return { timestamp: Date.now() - createdAt, level, message };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function jsonError(message: string, code = 'ERROR', status = 400): Response {
  return json({ code, message }, status);
}

function extractChapterContent(fullText: string, chapter: { index: number; startIndex: number }, chapters: { index: number; startIndex: number }[]): string {
  const next = chapters.find(c => c.index === chapter.index + 1);
  const end = next ? next.startIndex : fullText.length;
  return fullText.slice(chapter.startIndex, end);
}

// ====== Worker Entry ======

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS
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
      if (path === '/' || path === '/index.html') {
        return new Response(HTML_CONTENT, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
      if (path === '/api/debug/youtube' && request.method === 'GET') {
        return await debugYouTube(request, env);
      }
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
      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return jsonError((e as Error).message, 'INTERNAL_ERROR', 500);
    }
  }
};

// ====== Handlers ======

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  let body: GenerateRequest;
  try {
    body = await request.json() as GenerateRequest;
  } catch {
    return jsonError('Invalid JSON body', 'INVALID_BODY');
  }

  if (!isValidYouTubeUrl(body.videoUrl)) {
    return jsonError('Invalid YouTube URL', 'INVALID_URL');
  }

  const videoId = extractVideoId(body.videoUrl);
  const requirements = sanitizeRequirements(body.requirements);
  const manualSubtitles = body.manualSubtitles?.trim().slice(0, INPUT_LIMITS.manualSubtitles);

  const { subtitles, source, attempts } = await getSubtitles(videoId, manualSubtitles, env);

  if (!subtitles) {
    return jsonError(
      '无法获取字幕。请在「手动粘贴字幕」框中粘贴 YouTube 字幕（YouTube 视频页面 → 三个点 → 显示转录稿 → 复制文本）。演示视频请用 xRh2sVcNXQ8。',
      'NO_SUBTITLES'
    );
  }

  const sessionId = crypto.randomUUID();
  const createdAt = Date.now();
  const session: Session = {
    id: sessionId,
    videoUrl: body.videoUrl,
    videoId,
    subtitles,
    subtitleSource: source,
    userRequirements: requirements,
    article: { fullText: '', chapters: [] },
    status: 'idle',
    logs: attemptsToLogs(attempts, createdAt),
    createdAt,
    updatedAt: createdAt
  };

  const storage = new StorageService(env.KV_BINDING);
  await storage.saveSession(session);

  return json({
    sessionId,
    status: 'generating',
    subtitleSource: source
  });
}

async function handleStream(request: Request, env: Env): Promise<Response> {
  const sessionId = new URL(request.url).pathname.split('/').pop()!;
  const storage = new StorageService(env.KV_BINDING);
  const session = await storage.getSession(sessionId);

  if (!session) {
    return jsonError('Session not found', 'SESSION_NOT_FOUND', 404);
  }

  await storage.updateStatus(sessionId, 'generating');
  const llm = new LLMService(env.MINIMAX_API_KEY);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: SSEChunk) => {
        controller.enqueue(encoder.encode(
          `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`
        ));
      };

      const parserState = createParserState();
      let fullText = '';
      const chapterStarts: number[] = [];
      let chapterCount = 0;
      const localChapters: Chapter[] = [];

      // 字幕信息事件
      send({
        type: 'subtitle',
        source: session.subtitleSource,
        charCount: session.subtitles.length
      });

      try {
        for await (const chunk of llm.generateStream(session.subtitles, session.userRequirements)) {
          if (chunk.type === 'text' && chunk.content) {
            const { events } = parseChunk(chunk.content, parserState);
            for (const event of events) {
              if (event.type === 'chapter') {
                chapterCount++;
                chapterStarts.push(fullText.length);
                const chapter: Chapter = {
                  index: event.index,
                  title: event.title,
                  startIndex: fullText.length
                };
                localChapters.push(chapter);
                session.article.chapters.push(chapter);
                send({ type: 'chapter', index: event.index, title: event.title });
              } else if (event.type === 'text') {
                fullText += event.content;
                send({ type: 'text', content: event.content });
              }
            }
          }
        }

        // flush 剩余 buffer
        const { events: finalEvents } = flushBuffer(parserState);
        for (const event of finalEvents) {
          if (event.type === 'text') {
            fullText += event.content;
            send({ type: 'text', content: event.content });
          }
        }

        if (chapterCount === 0) {
          send({ type: 'log', level: 'ERROR', message: 'AI 未输出 [CHAPTER] 标记' } as SSEChunk);
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
  // URL: /api/chapter/{sessionId}/{idx}/summary
  // parts: ['', 'api', 'chapter', sessionId, idx, 'summary']
  const parts = new URL(request.url).pathname.split('/');
  const sessionId = parts[parts.length - 3];
  const chapterIndex = parseInt(parts[parts.length - 2], 10);

  if (!isValidUUID(sessionId) || isNaN(chapterIndex)) {
    return jsonError('Invalid parameters', 'INVALID_PARAMS');
  }

  const storage = new StorageService(env.KV_BINDING);
  const session = await storage.getSession(sessionId);

  if (!session) {
    return jsonError('Session not found', 'SESSION_NOT_FOUND', 404);
  }

  const chapter = session.article.chapters.find(c => c.index === chapterIndex);
  if (!chapter) {
    return jsonError('Chapter not found', 'CHAPTER_NOT_FOUND', 404);
  }

  if (chapter.summary5w1h) {
    return json(chapter.summary5w1h);
  }

  try {
    const llm = new LLMService(env.MINIMAX_API_KEY);
    const chapterContent = extractChapterContent(
      session.article.fullText,
      chapter,
      session.article.chapters
    );
    const summary = await llm.generateSummary(
      session.article.fullText,
      chapter.title,
      chapterContent
    );
    await storage.save5w1h(sessionId, chapterIndex, summary);
    return json(summary);
  } catch (e) {
    return jsonError(`5W1H 失败: ${(e as Error).message}`, 'SUMMARY_ERROR', 500);
  }
}

async function handleGetSession(request: Request, env: Env): Promise<Response> {
  const sessionId = new URL(request.url).pathname.split('/').pop()!;
  const storage = new StorageService(env.KV_BINDING);
  const session = await storage.getSession(sessionId);

  if (!session) {
    return jsonError('Session not found', 'SESSION_NOT_FOUND', 404);
  }
  return json(session);
}

async function handleDeleteSession(request: Request, env: Env): Promise<Response> {
  const sessionId = new URL(request.url).pathname.split('/').pop()!;
  const storage = new StorageService(env.KV_BINDING);
  await storage.deleteSession(sessionId);
  return json({ success: true });
}

// 诊断端点：测试 YouTube 字幕获取链路（直拉 + 代理）
// 支持 ?videoId=xxx 查询具体视频（默认 dQw4w9WgXcQ 通道测试）
async function debugYouTube(request: Request, env: Env): Promise<Response> {
  const videoId = new URL(request.url).searchParams.get('videoId') || 'dQw4w9WgXcQ';
  const tests: Record<string, unknown> = { videoId };

  // Test 1: 直接 fetch YouTube 首页（验证 Worker 出口能不能连通 YouTube）
  try {
    const r1 = await fetch('https://www.youtube.com/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    tests.homepage = { status: r1.status, ok: r1.ok };
  } catch (e) {
    tests.homepage = { error: (e as Error).message };
  }

  // Test 2: 直拉模式（无代理）走我们的 InnerTube + timedtext 实现
  try {
    const r = await fetchYouTubeSubtitles(videoId);
    tests.directFetch = {
      success: true,
      languageCode: r.languageCode,
      isAutoGenerated: r.isAutoGenerated,
      charCount: r.text.length,
      preview: r.text.slice(0, 200)
    };
  } catch (e) {
    tests.directFetch = { success: false, error: (e as Error).message };
  }

  // Test 3: 代理模式（webshare）— 配置存在才跑
  const proxy = loadProxyConfig(env as unknown as Record<string, string | undefined>);
  if (proxy) {
    try {
      const r = await fetchYouTubeSubtitles(videoId, { proxy });
      tests.proxyFetch = {
        success: true,
        proxyHost: `${proxy.host}:${proxy.port}`,
        languageCode: r.languageCode,
        isAutoGenerated: r.isAutoGenerated,
        charCount: r.text.length,
        preview: r.text.slice(0, 200)
      };
    } catch (e) {
      tests.proxyFetch = {
        success: false,
        proxyHost: `${proxy.host}:${proxy.port}`,
        error: (e as Error).message
      };
    }
  } else {
    tests.proxyFetch = { skipped: '未配置 PROXY_HOST/PORT/USERNAME/PASSWORD' };
  }

  return json(tests);
}
