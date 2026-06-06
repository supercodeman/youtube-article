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

    const jsonMatch = text.match(/\{[\s\S]*?"who"[\s\S]*?\}/);
    if (!jsonMatch) {
      throw new Error(`5W1H JSON 解析失败：${text.slice(0, 100)}`);
    }

    return JSON.parse(jsonMatch[0]);
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
