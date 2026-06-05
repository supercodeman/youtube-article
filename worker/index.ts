import type { Session, LogEntry, SSEChunk, GenerateRequest, ErrorResponse } from './types';
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

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YouTube 字幕转文章</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.6;
      background: #1a1a2e;
      color: #e0e0e0;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { color: #667eea; margin-bottom: 2rem; }
    .card {
      background: #16213e;
      border: 1px solid #1f3460;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    label { display: block; color: #a78bfa; margin-bottom: 0.5rem; font-weight: 500; }
    input, textarea {
      width: 100%;
      padding: 0.75rem;
      background: #0f1629;
      border: 1px solid #1f3460;
      border-radius: 8px;
      color: #e0e0e0;
      font-size: 1rem;
    }
    input:focus, textarea:focus { outline: none; border-color: #667eea; }
    textarea { resize: vertical; min-height: 80px; }
    button {
      padding: 0.75rem 1.5rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-small { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
    .progress {
      height: 4px;
      background: #0f1629;
      border-radius: 2px;
      margin: 1rem 0;
      overflow: hidden;
    }
    .progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #667eea, #764ba2);
      width: 0%;
      transition: width 0.3s;
    }
    .status { color: #6b7280; font-size: 0.9rem; margin-top: 0.5rem; }
    .article { font-size: 1.05rem; line-height: 1.8; }
    .chapter { margin: 2rem 0; }
    .chapter-title {
      color: #667eea;
      font-size: 1.3rem;
      font-weight: 600;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #1f3460;
    }
    .chapter-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .text-content { color: #d1d5db; white-space: pre-wrap; }
    .summary-box {
      background: #0f1629;
      border-radius: 8px;
      padding: 1rem;
      margin-top: 1rem;
      display: none;
    }
    .summary-box.visible { display: block; }
    .summary-item { margin: 0.5rem 0; }
    .summary-label { color: #667eea; font-weight: 500; }
    .error { color: #fca5a5; padding: 1rem; background: #1f1460; border-radius: 8px; }
    .hidden { display: none; }

    /* Log Panel */
    .log-panel {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #0f1629;
      border-top: 2px solid #1f3460;
      max-height: 40vh;
      display: flex;
      flex-direction: column;
      z-index: 1000;
    }
    .log-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      background: #16213e;
      cursor: pointer;
      user-select: none;
    }
    .log-header:hover { background: #1a2744; }
    .log-title { color: #667eea; font-weight: 600; }
    .log-toggle { color: #a78bfa; font-size: 0.9rem; }
    .log-content {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem 1rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.85rem;
      line-height: 1.5;
    }
    .log-entry { margin: 0.25rem 0; display: flex; gap: 0.5rem; }
    .log-time { color: #6b7280; min-width: 60px; }
    .log-level { min-width: 50px; font-weight: 600; }
    .log-level.INFO { color: #60a5fa; }
    .log-level.SUCCESS { color: #34d399; }
    .log-level.ERROR { color: #f87171; }
    .log-message { color: #e0e0e0; }
    .log-collapsed .log-content { display: none; }

    /* Header actions */
    .header-actions {
      position: fixed;
      top: 1rem;
      right: 2rem;
      display: flex;
      gap: 0.5rem;
    }
    .header-btn {
      padding: 0.5rem 1rem;
      background: #16213e;
      border: 1px solid #1f3460;
      border-radius: 8px;
      color: #a78bfa;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .header-btn:hover { border-color: #667eea; }
    .header-btn.active { background: #667eea; color: white; border-color: #667eea; }
    .main-content { padding-bottom: 50px; }
  </style>
</head>
<body>
  <div class="header-actions">
    <button id="toggleLogBtn" class="header-btn">[日志]</button>
  </div>

  <div class="container main-content">
    <h1>YouTube 字幕转文章</h1>

    <div class="card">
      <label for="videoUrl">YouTube 视频链接</label>
      <input type="text" id="videoUrl" placeholder="https://www.youtube.com/watch?v=xRh2sVcNXQ8">
    </div>

    <div class="card">
      <label for="requirements">生成要求（可选）</label>
      <textarea id="requirements" placeholder="例如：用轻松的语气，面向程序员"></textarea>
    </div>

    <button id="generateBtn">生成文章</button>

    <div id="progressSection" class="card hidden">
      <div class="progress"><div class="progress-bar" id="progressBar"></div></div>
      <div class="status" id="statusText">正在获取字幕...</div>
    </div>

    <div id="errorSection" class="error hidden"></div>

    <div id="articleSection" class="card hidden">
      <div class="article" id="articleContent"></div>
    </div>
  </div>

  <!-- Log Panel -->
  <div id="logPanel" class="log-panel log-collapsed">
    <div class="log-header" id="logHeader">
      <span class="log-title">▼ 操作日志</span>
      <span class="log-toggle">[收起]</span>
    </div>
    <div class="log-content" id="logContent">
      <div class="log-entry">
        <span class="log-time">--:--</span>
        <span class="log-level INFO">INFO</span>
        <span class="log-message">等待用户操作...</span>
      </div>
    </div>
  </div>

  <script>
    const API_BASE = '';

    let sessionId = null;
    let logVisible = false;

    // Log panel toggle
    const logPanel = document.getElementById('logPanel');
    const logHeader = document.getElementById('logHeader');
    const logContent = document.getElementById('logContent');
    const toggleLogBtn = document.getElementById('toggleLogBtn');

    function toggleLogPanel() {
      logVisible = !logVisible;
      logPanel.classList.toggle('log-collapsed', !logVisible);
      toggleLogBtn.classList.toggle('active', logVisible);
      const title = logPanel.querySelector('.log-title');
      const toggle = logPanel.querySelector('.log-toggle');
      if (title) title.textContent = logVisible ? '▲ 操作日志' : '▼ 操作日志';
      if (toggle) toggle.textContent = logVisible ? '[收起]' : '[展开]';
    }

    logHeader.addEventListener('click', toggleLogPanel);
    toggleLogBtn.addEventListener('click', toggleLogPanel);

    function addLog(level, message) {
      const now = new Date();
      const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = \`
        <span class="log-time">\${time}</span>
        <span class="log-level \${level}">\${level}</span>
        <span class="log-message">\${escapeHtml(message)}</span>
      \`;

      logContent.appendChild(entry);

      // Auto-scroll to bottom
      if (logVisible) {
        logContent.scrollTop = logContent.scrollHeight;
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    document.getElementById('generateBtn').addEventListener('click', startGeneration);

    async function startGeneration() {
      const videoUrl = document.getElementById('videoUrl').value.trim();
      const requirements = document.getElementById('requirements').value.trim();

      if (!videoUrl) {
        showError('请输入 YouTube 视频链接');
        return;
      }

      sessionId = null;
      document.getElementById('errorSection').classList.add('hidden');
      document.getElementById('articleSection').classList.add('hidden');
      document.getElementById('progressSection').classList.remove('hidden');
      document.getElementById('articleContent').innerHTML = '';
      updateProgress(0, '正在连接...');
      document.getElementById('generateBtn').disabled = true;

      addLog('INFO', '开始生成文章...');
      addLog('INFO', '视频URL: ' + videoUrl);

      try {
        addLog('INFO', '正在创建 Session...');
        const res = await fetch(\`\${API_BASE}/api/generate\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl, requirements })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || '启动生成失败');
        }

        const data = await res.json();
        sessionId = data.sessionId;
        addLog('SUCCESS', 'Session 创建成功: ' + sessionId);
        updateProgress(10, '正在获取字幕...');
        addLog('INFO', '开始获取字幕...');

        await connectSSE();
      } catch (e) {
        addLog('ERROR', '生成失败: ' + e.message);
        showError(e.message);
        document.getElementById('progressSection').classList.add('hidden');
        document.getElementById('generateBtn').disabled = false;
      }
    }

    async function connectSSE() {
      const articleContent = document.getElementById('articleContent');
      const eventSource = new EventSource(\`\${API_BASE}/api/stream/\${sessionId}\`);

      eventSource.addEventListener('chapter', (event) => {
        const data = JSON.parse(event.data);
        addLog('INFO', '[CHAPTER ' + (data.index + 1) + '] 开始: ' + data.title);

        const chapterEl = document.createElement('div');
        chapterEl.className = 'chapter';
        chapterEl.dataset.index = data.index;
        chapterEl.innerHTML = \`
          <div class="chapter-header">
            <h2 class="chapter-title">[CHAPTER \${data.index + 1}: \${data.title}]</h2>
            <button class="btn-small" onclick="loadSummary(\${data.index})">[5W1H]</button>
          </div>
          <div class="text-content"></div>
          <div class="summary-box"></div>
        \`;
        articleContent.appendChild(chapterEl);
        updateProgress(50, '正在生成内容...');
      });

      eventSource.addEventListener('text', (event) => {
        const data = JSON.parse(event.data);
        const chapters = articleContent.querySelectorAll('.chapter');
        const lastChapter = chapters[chapters.length - 1];
        if (lastChapter) {
          const textContent = lastChapter.querySelector('.text-content');
          if (textContent) textContent.textContent += data.content;
        }
        updateProgress(70, '正在生成内容...');
      });

      eventSource.addEventListener('subtitle', (event) => {
        const data = JSON.parse(event.data);
        addLog('SUCCESS', '字幕获取完成 (' + data.source + '): ' + data.charCount + ' 字符');
      });

      eventSource.addEventListener('done', (event) => {
        isDone = true;
        eventSource.close();
        updateProgress(100, '生成完成');
        document.getElementById('progressSection').classList.add('hidden');
        document.getElementById('generateBtn').disabled = false;
        addLog('SUCCESS', '文章生成完成');
      });

      eventSource.addEventListener('error', (event) => {
        const data = JSON.parse(event.data);
        addLog('ERROR', '流式错误: ' + data.content);
      });

      let isDone = false;
      eventSource.onerror = (e) => {
        if (isDone) return;
        isDone = true;
        addLog('ERROR', 'SSE 连接中断');
        showError('连接中断，请重试');
        eventSource.close();
        document.getElementById('progressSection').classList.add('hidden');
        document.getElementById('generateBtn').disabled = false;
      };
    }

    async function loadSummary(chapterIndex) {
      addLog('INFO', '请求章节 ' + (chapterIndex + 1) + ' 的 5W1H 总结...');

      const chapters = document.querySelectorAll('.chapter');
      const chapterEl = chapters[chapterIndex];
      if (!chapterEl) return;

      const summaryBox = chapterEl.querySelector('.summary-box');
      if (summaryBox.classList.contains('visible')) {
        summaryBox.classList.remove('visible');
        return;
      }

      summaryBox.classList.add('visible');

      const whoEl = summaryBox.querySelector('.summary-who');
      if (whoEl && whoEl.textContent) {
        addLog('INFO', '章节 ' + (chapterIndex + 1) + ' 总结已缓存');
        return;
      }

      summaryBox.innerHTML = '<div class="status">正在加载总结...</div>';
      addLog('INFO', '正在生成 5W1H 总结...');

      try {
        const res = await fetch(\`\${API_BASE}/api/chapter/\${sessionId}/\${chapterIndex}/summary\`);

        let data;
        try {
          data = await res.json();
        } catch {
          throw new Error('服务器返回非 JSON 响应 (HTTP ' + res.status + ')');
        }

        if (!res.ok) {
          throw new Error(data.message || \`HTTP \${res.status}\`);
        }

        summaryBox.innerHTML = \`
          <div class="summary-item"><span class="summary-label">Who:</span> <span class="summary-who">\${escapeHtml(data.who)}</span></div>
          <div class="summary-item"><span class="summary-label">What:</span> <span class="summary-what">\${escapeHtml(data.what)}</span></div>
          <div class="summary-item"><span class="summary-label">When:</span> <span class="summary-when">\${escapeHtml(data.when)}</span></div>
          <div class="summary-item"><span class="summary-label">Where:</span> <span class="summary-where">\${escapeHtml(data.where)}</span></div>
          <div class="summary-item"><span class="summary-label">Why:</span> <span class="summary-why">\${escapeHtml(data.why)}</span></div>
          <div class="summary-item"><span class="summary-label">How:</span> <span class="summary-how">\${escapeHtml(data.how)}</span></div>
        \`;
        addLog('SUCCESS', '章节 ' + (chapterIndex + 1) + ' 5W1H 总结生成完成');
      } catch (e) {
        summaryBox.innerHTML = \`<div class="error">\${escapeHtml(e.message)}</div>\`;
        addLog('ERROR', '5W1H 总结加载失败: ' + e.message);
      }
    }

    function updateProgress(percent, text) {
      document.getElementById('progressBar').style.width = percent + '%';
      document.getElementById('statusText').textContent = text;
      document.getElementById('articleSection').classList.remove('hidden');
    }

    function showError(message) {
      const errorEl = document.getElementById('errorSection');
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
  </script>
</body>
</html>`;

interface Env {
  MINIMAX_API_KEY: string;
  KV_BINDING: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

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
        return new Response(HTML_CONTENT, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return jsonError((e as Error).message);
    }
  }
};

function createLog(level: 'INFO' | 'SUCCESS' | 'ERROR', message: string, createdAt: number): LogEntry {
  return { timestamp: Date.now() - createdAt, level, message };
}

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as GenerateRequest;
  const createdAt = Date.now();
  const logs: LogEntry[] = [createLog('INFO', '开始处理请求', createdAt)];

  if (!isValidYouTubeUrl(body.videoUrl)) {
    logs.push(createLog('ERROR', '无效的 YouTube URL', createdAt));
    return jsonError('Invalid YouTube URL', 'INVALID_URL');
  }

  const videoId = extractVideoId(body.videoUrl);
  const requirements = sanitizeRequirements(body.requirements);

  logs.push(createLog('INFO', `解析视频 ID: ${videoId}`, createdAt));

  const sessionId = crypto.randomUUID();
  const session: Session = {
    id: sessionId,
    videoUrl: body.videoUrl,
    videoId,
    subtitles: '',
    subtitleSource: 'fallback',
    userRequirements: requirements,
    article: { fullText: '', chapters: [] },
    status: 'idle',
    logs,
    createdAt,
    updatedAt: Date.now()
  };

  const storage = new StorageService(env.KV_BINDING);
  await storage.saveSession(session);

  logs.push(createLog('SUCCESS', `Session 创建成功: ${sessionId}`, createdAt));

  return json({ sessionId, status: 'generating', logs });
}

async function handleStream(request: Request, env: Env): Promise<Response> {
  const sessionId = extractSessionId(request.url);
  const createdAt = Date.now();
  const storage = new StorageService(env.KV_BINDING);
  const session = await storage.getSession(sessionId);

  if (!session) {
    return jsonError('Session not found', 'SESSION_NOT_FOUND');
  }

  // Add log helper
  const addLog = (level: 'INFO' | 'SUCCESS' | 'ERROR', message: string) => {
    session.logs.push(createLog(level, message, createdAt));
    if (session.logs.length > 100) {
      session.logs = session.logs.slice(-100);
    }
  };

  await storage.updateStatus(sessionId, 'generating');

  const subtitleService = new SubtitleService(session.videoId);
  addLog('INFO', '开始获取字幕...');

  const { subtitles, source } = await subtitleService.fetchSubtitles();
  session.subtitles = subtitles;
  session.subtitleSource = source;

  addLog('INFO', `字幕获取完成 (来源: ${source}): ${subtitles.length} 字符`);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const gemini = new GeminiService(env.MINIMAX_API_KEY);
      const parserState = createParserState();
      let fullText = '';

      const send = (data: SSEChunk) => {
        controller.enqueue(encoder.encode(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Send subtitle info to frontend
      send({ type: 'subtitle', source, charCount: subtitles.length } as SSEChunk);

      try {
        addLog('INFO', '开始生成文章...');

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
        session.logs = session.logs;
        await storage.saveSession(session);
        send({ type: 'done', chapters: session.article.chapters });

        addLog('SUCCESS', '文章生成完成');

      } catch (e) {
        session.status = 'error';
        session.logs = session.logs;
        await storage.saveSession(session);
        send({ type: 'error', content: (e as Error).message } as SSEChunk);
        addLog('ERROR', `生成失败: ${(e as Error).message}`);
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

  const storage = new StorageService(env.KV_BINDING);
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

  try {
    const gemini = new GeminiService(env.MINIMAX_API_KEY);
    const chapterContent = extractChapterContent(session.article.fullText, chapter, session.article.chapters);
    const summary = await gemini.generateSummary(
      session.article.fullText,
      chapter.title,
      chapterContent
    );

    await storage.save5w1h(sessionId, chapterIndex, summary);
    return json(summary);
  } catch (e) {
    return jsonError(`5W1H 生成失败: ${(e as Error).message}`, 'SUMMARY_ERROR');
  }
}

async function handleGetSession(request: Request, env: Env): Promise<Response> {
  const sessionId = extractSessionId(request.url);
  const storage = new StorageService(env.KV_BINDING);
  const session = await storage.getSession(sessionId);

  if (!session) {
    return jsonError('Session not found', 'SESSION_NOT_FOUND');
  }

  return json(session);
}

async function handleDeleteSession(request: Request, env: Env): Promise<Response> {
  const sessionId = extractSessionId(request.url);
  const storage = new StorageService(env.KV_BINDING);
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