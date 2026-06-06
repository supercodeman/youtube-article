import type { SSEChunk, FiveW1H } from '../types';
import { LLM_CONFIG } from '../config';
import { buildArticlePrompt, buildSummaryPrompt } from '../utils/prompt';

// LLM 服务封装（OpenAI Chat Completions 兼容协议）
// 当前实际接 MiniMax-M2.7（via api.minimax.chat 网关），切换 Gemini/其它仅需改 LLM_CONFIG。
export class LLMService {
  constructor(private apiKey: string) {}

  async *generateStream(
    subtitles: string,
    requirements?: string
  ): AsyncGenerator<SSEChunk, void, unknown> {
    const prompt = buildArticlePrompt(subtitles, requirements);
    const response = await this.callChatCompletion(prompt, true);

    yield* this.parseStream(response);
  }

  async generateSummary(
    fullText: string,
    chapterTitle: string,
    chapterContent: string
  ): Promise<FiveW1H> {
    const prompt = buildSummaryPrompt(fullText, chapterTitle, chapterContent);
    const response = await this.callChatCompletion(prompt, false);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content || '';

    if (!text) {
      throw new Error('LLM 返回空内容');
    }

    // 先剥掉可能的 markdown 围栏 ```json ... ```，再找 JSON
    const stripped = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    // 用平衡大括号找 JSON（LLM 偶尔会在 JSON 前后加解释文字）
    const start = stripped.indexOf('{');
    if (start === -1) {
      throw new Error(`5W1H JSON 解析失败（无 { 起始符）：${text.slice(0, 200)}`);
    }
    let depth = 0;
    let end = -1;
    let inString = false;
    let escape = false;
    for (let i = start; i < stripped.length; i++) {
      const c = stripped[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end === -1) {
      throw new Error(`5W1H JSON 解析失败（大括号未闭合）：${text.slice(0, 200)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped.slice(start, end));
    } catch (e) {
      throw new Error(`5W1H JSON 解析失败（语法错）：${(e as Error).message} | 原始: ${text.slice(0, 200)}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`5W1H JSON 解析失败（不是对象）：${text.slice(0, 200)}`);
    }
    const obj = parsed as Record<string, unknown>;
    const fields = ['who', 'what', 'when', 'where', 'why', 'how'] as const;
    for (const f of fields) {
      if (typeof obj[f] !== 'string') {
        throw new Error(`5W1H JSON 缺少字段 ${f}：${text.slice(0, 200)}`);
      }
    }
    return obj as unknown as FiveW1H;
  }

  private async callChatCompletion(prompt: string, stream: boolean): Promise<Response> {
    return fetch(`${LLM_CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: LLM_CONFIG.model,
        messages: [{ role: 'user', content: prompt }],
        stream
      })
    });
  }

  private async *parseStream(response: Response): AsyncGenerator<SSEChunk, void, unknown> {
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM HTTP ${response.status}：${error.slice(0, 200)}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            yield { type: 'text', content };
          }
        } catch {
          // 跳过无效 JSON（部分供应商 keep-alive 心跳）
        }
      }
    }
  }
}
