// 内联的前端 HTML（含 CSS 与 JS）
// 抽到独立文件以使 index.ts 控制在 500 行以内（CLAUDE.md 规则）
// 修改前端时只动这一个文件即可。

export const HTML_CONTENT = `<!DOCTYPE html>
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
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 860px; margin: 0 auto; }
    h1 {
      background: linear-gradient(135deg, #60a5fa 0%, #c084fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 1.5rem;
      font-size: 2rem;
    }
    .subtitle { color: #94a3b8; margin-bottom: 2rem; font-size: 0.95rem; }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      color: #c084fc;
      margin-bottom: 0.5rem;
      font-weight: 500;
      font-size: 0.9rem;
    }
    input, textarea {
      width: 100%;
      padding: 0.75rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #e2e8f0;
      font-size: 0.95rem;
      font-family: inherit;
    }
    input:focus, textarea:focus { outline: none; border-color: #60a5fa; }
    textarea { resize: vertical; min-height: 80px; }
    .hint { color: #64748b; font-size: 0.8rem; margin-top: 0.4rem; }

    button {
      padding: 0.75rem 1.5rem;
      background: linear-gradient(135deg, #60a5fa 0%, #c084fc 100%);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: transform 0.1s, opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    button:active { transform: scale(0.98); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-small { padding: 0.3rem 0.7rem; font-size: 0.8rem; }

    .progress { height: 4px; background: #0f172a; border-radius: 2px; margin: 1rem 0; overflow: hidden; }
    .progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #60a5fa, #c084fc);
      width: 0%;
      transition: width 0.3s;
    }
    .status { color: #94a3b8; font-size: 0.9rem; margin-top: 0.5rem; }

    .article { font-size: 1.05rem; line-height: 1.85; }
    .chapter { margin: 1.5rem 0; padding: 1.25rem; background: #0f172a; border-radius: 8px; }
    .chapter-title {
      color: #60a5fa;
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    .chapter-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .text-content { color: #cbd5e1; white-space: pre-wrap; }
    .summary-box {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 1rem;
      margin-top: 1rem;
      display: none;
    }
    .summary-box.visible { display: block; }
    .summary-item { margin: 0.5rem 0; }
    .summary-label { color: #c084fc; font-weight: 500; }
    .error { color: #fca5a5; padding: 1rem; background: #450a0a; border-radius: 8px; }
    .hidden { display: none; }

    /* Log Panel */
    .log-panel {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #0f172a;
      border-top: 2px solid #334155;
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
      background: #1e293b;
      cursor: pointer;
      user-select: none;
    }
    .log-header:hover { background: #273548; }
    .log-title { color: #60a5fa; font-weight: 600; font-size: 0.9rem; }
    .log-toggle { color: #94a3b8; font-size: 0.85rem; }
    .log-content {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem 1rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.8rem;
      line-height: 1.5;
    }
    .log-entry { margin: 0.2rem 0; display: flex; gap: 0.5rem; word-break: break-all; }
    .log-time { color: #64748b; min-width: 70px; flex-shrink: 0; }
    .log-level { min-width: 50px; font-weight: 600; flex-shrink: 0; }
    .log-level.INFO { color: #60a5fa; }
    .log-level.SUCCESS { color: #34d399; }
    .log-level.ERROR { color: #f87171; }
    .log-message { color: #cbd5e1; }
    .log-collapsed .log-content { display: none; }

    .main-content { padding-bottom: 50px; }
  </style>
</head>
<body>
  <div class="container main-content">
    <h1>YouTube 字幕转文章</h1>
    <div class="subtitle">基于 AI 的视频内容结构化分析 · 流式输出 · 章节 5W1H 总结</div>

    <div class="card">
      <label for="videoUrl">YouTube 视频链接</label>
      <input type="text" id="videoUrl" placeholder="https://www.youtube.com/watch?v=xRh2sVcNXQ8">
      <div class="hint">演示视频填 xRh2sVcNXQ8；其他视频请粘贴字幕</div>
    </div>

    <div class="card">
      <label for="manualSubtitles">手动粘贴字幕（可选，留空使用演示视频）</label>
      <textarea id="manualSubtitles" placeholder="[00:00] 字幕第一行&#10;[00:15] 字幕第二行&#10;..." rows="6"></textarea>
      <div class="hint">从 YouTube 复制字幕粘贴到这里（最多 5000 字符）</div>
    </div>

    <div class="card">
      <label for="requirements">生成要求（可选）</label>
      <textarea id="requirements" placeholder="例如：用轻松的语气，面向程序员"></textarea>
    </div>

    <button id="generateBtn">生成文章</button>

    <div id="progressSection" class="card hidden">
      <div class="progress"><div class="progress-bar" id="progressBar"></div></div>
      <div class="status" id="statusText">正在连接...</div>
    </div>

    <div id="errorSection" class="error hidden"></div>

    <div id="articleSection" class="card hidden">
      <div class="article" id="articleContent"></div>
    </div>
  </div>

  <div id="logPanel" class="log-panel log-collapsed">
    <div class="log-header" id="logHeader">
      <span class="log-title" id="logTitle">▶ 操作日志</span>
      <span class="log-toggle" id="logToggle">[展开]</span>
    </div>
    <div class="log-content" id="logContent"></div>
  </div>

  <script>
    const API = '';
    let sessionId = null;
    let logVisible = false;

    // ====== Log Panel ======
    const logPanel = document.getElementById('logPanel');
    const logTitle = document.getElementById('logTitle');
    const logToggle = document.getElementById('logToggle');

    function toggleLog() {
      logVisible = !logVisible;
      logPanel.classList.toggle('log-collapsed', !logVisible);
      logTitle.textContent = logVisible ? '▼ 操作日志' : '▶ 操作日志';
      logToggle.textContent = logVisible ? '[收起]' : '[展开]';
      if (logVisible) {
        document.getElementById('logContent').scrollTop = 99999;
      }
    }
    document.getElementById('logHeader').addEventListener('click', toggleLog);

    function addLog(level, message) {
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML =
        '<span class="log-time">' + time + '</span>' +
        '<span class="log-level ' + level + '">' + level + '</span>' +
        '<span class="log-message">' + escapeHtml(message) + '</span>';
      document.getElementById('logContent').appendChild(entry);
      if (logVisible) {
        document.getElementById('logContent').scrollTop = 99999;
      }
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }

    // ====== Generate ======
    document.getElementById('generateBtn').addEventListener('click', startGeneration);

    async function startGeneration() {
      const videoUrl = document.getElementById('videoUrl').value.trim();
      const requirements = document.getElementById('requirements').value.trim();
      const manualSubtitles = document.getElementById('manualSubtitles').value.trim();

      if (!videoUrl) { showError('请输入 YouTube 视频链接'); return; }

      sessionId = null;
      document.getElementById('errorSection').classList.add('hidden');
      document.getElementById('articleSection').classList.add('hidden');
      document.getElementById('progressSection').classList.remove('hidden');
      document.getElementById('articleContent').innerHTML = '';
      updateProgress(0, '正在连接...');
      document.getElementById('generateBtn').disabled = true;

      addLog('INFO', '开始生成文章');
      addLog('INFO', 'URL: ' + videoUrl);
      if (manualSubtitles) addLog('INFO', '使用手动粘贴字幕 (' + manualSubtitles.length + ' 字符)');

      try {
        addLog('INFO', '创建 Session...');
        const res = await fetch(API + '/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl, requirements, manualSubtitles })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || '启动失败 (HTTP ' + res.status + ')');
        }

        const data = await res.json();
        sessionId = data.sessionId;
        addLog('SUCCESS', 'Session: ' + sessionId);
        addLog('INFO', '字幕来源: ' + data.subtitleSource);
        updateProgress(15, '正在生成文章...');
        await connectSSE();
      } catch (e) {
        addLog('ERROR', e.message);
        showError(e.message);
        document.getElementById('progressSection').classList.add('hidden');
        document.getElementById('generateBtn').disabled = false;
      }
    }

    async function connectSSE() {
      const articleContent = document.getElementById('articleContent');
      const es = new EventSource(API + '/api/stream/' + sessionId);
      let isDone = false;

      es.addEventListener('subtitle', (e) => {
        const d = JSON.parse(e.data);
        addLog('SUCCESS', '字幕就绪 (' + d.source + '): ' + d.charCount + ' 字符');
        updateProgress(25, '正在生成文章...');
      });

      es.addEventListener('chapter', (e) => {
        const d = JSON.parse(e.data);
        addLog('INFO', '[CHAPTER ' + (d.index + 1) + '] ' + d.title);
        const el = document.createElement('div');
        el.className = 'chapter';
        el.dataset.index = d.index;
        el.innerHTML =
          '<div class="chapter-header">' +
            '<h2 class="chapter-title">[CHAPTER ' + (d.index + 1) + ': ' + escapeHtml(d.title) + ']</h2>' +
            '<button class="btn-small" onclick="loadSummary(' + d.index + ')">[5W1H]</button>' +
          '</div>' +
          '<div class="text-content"></div>' +
          '<div class="summary-box"></div>';
        articleContent.appendChild(el);
        updateProgress(50, '正在生成内容...');
      });

      es.addEventListener('text', (e) => {
        const d = JSON.parse(e.data);
        let last = articleContent.querySelectorAll('.chapter');
        last = last[last.length - 1];
        if (!last) {
          // 没有 chapter 时，text 直接追加到 articleContent（不分章节）
          const intro = document.createElement('div');
          intro.className = 'text-content';
          intro.textContent = d.content;
          articleContent.appendChild(intro);
        } else {
          const tc = last.querySelector('.text-content');
          if (tc) tc.textContent += d.content;
        }
        updateProgress(70, '正在生成内容...');
      });

      es.addEventListener('log', (e) => {
        const d = JSON.parse(e.data);
        if (d.level && d.message) addLog(d.level, d.message);
      });

      es.addEventListener('done', () => {
        isDone = true;
        es.close();
        updateProgress(100, '生成完成');
        document.getElementById('progressSection').classList.add('hidden');
        document.getElementById('generateBtn').disabled = false;
        addLog('SUCCESS', '文章生成完成');
      });

      es.addEventListener('error', (e) => {
        if (isDone) return;
        try {
          const d = JSON.parse(e.data);
          if (d.content) {
            addLog('ERROR', '流式错误: ' + d.content);
            showError(d.content);
          }
        } catch {}
      });

      es.onerror = () => {
        if (isDone) return;
        isDone = true;
        addLog('ERROR', 'SSE 连接中断');
        showError('连接中断，请重试');
        es.close();
        document.getElementById('progressSection').classList.add('hidden');
        document.getElementById('generateBtn').disabled = false;
      };
    }

    async function loadSummary(idx) {
      const chapters = document.querySelectorAll('.chapter');
      const chapterEl = chapters[idx];
      if (!chapterEl) return;
      const box = chapterEl.querySelector('.summary-box');
      if (box.classList.contains('visible')) {
        box.classList.remove('visible');
        return;
      }
      box.classList.add('visible');
      if (box.querySelector('.summary-who')) {
        addLog('INFO', '章节 ' + (idx + 1) + ' 总结已缓存');
        return;
      }
      box.innerHTML = '<div class="status">正在生成总结...</div>';
      addLog('INFO', '请求章节 ' + (idx + 1) + ' 5W1H 总结...');

      try {
        const res = await fetch(API + '/api/chapter/' + sessionId + '/' + idx + '/summary');
        let data;
        try { data = await res.json(); } catch { throw new Error('HTTP ' + res.status); }
        if (!res.ok) throw new Error(data.message || 'HTTP ' + res.status);

        box.innerHTML =
          '<div class="summary-item"><span class="summary-label">Who:</span> <span class="summary-who">' + escapeHtml(data.who) + '</span></div>' +
          '<div class="summary-item"><span class="summary-label">What:</span> <span class="summary-what">' + escapeHtml(data.what) + '</span></div>' +
          '<div class="summary-item"><span class="summary-label">When:</span> <span class="summary-when">' + escapeHtml(data.when) + '</span></div>' +
          '<div class="summary-item"><span class="summary-label">Where:</span> <span class="summary-where">' + escapeHtml(data.where) + '</span></div>' +
          '<div class="summary-item"><span class="summary-label">Why:</span> <span class="summary-why">' + escapeHtml(data.why) + '</span></div>' +
          '<div class="summary-item"><span class="summary-label">How:</span> <span class="summary-how">' + escapeHtml(data.how) + '</span></div>';
        addLog('SUCCESS', '章节 ' + (idx + 1) + ' 5W1H 完成');
      } catch (e) {
        box.innerHTML = '<div class="error">' + escapeHtml(e.message) + '</div>';
        addLog('ERROR', '5W1H 失败: ' + e.message);
      }
    }

    function updateProgress(p, text) {
      document.getElementById('progressBar').style.width = p + '%';
      document.getElementById('statusText').textContent = text;
      document.getElementById('articleSection').classList.remove('hidden');
    }
    function showError(msg) {
      const e = document.getElementById('errorSection');
      e.textContent = msg;
      e.classList.remove('hidden');
    }
  </script>
</body>
</html>`;
