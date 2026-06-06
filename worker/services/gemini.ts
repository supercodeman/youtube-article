import type { SSEChunk, FiveW1H } from '../types';
import { AI_CONFIG } from '../config';
import { buildArticlePrompt, buildSummaryPrompt } from '../utils/prompt';

export class GeminiService {
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
      throw new Error('Empty response from API');
    }

    const jsonMatch = text.match(/\{[\s\S]*?"who"[\s\S]*?\}/);
    if (!jsonMatch) {
      throw new Error(`Failed to parse 5W1H: ${text.slice(0, 100)}`);
    }

    return JSON.parse(jsonMatch[0]);
  }

  private async callChatCompletion(prompt: string, stream: boolean): Promise<Response> {
    return fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [{ role: 'user', content: prompt }],
        stream
      })
    });
  }

  private async *parseStream(response: Response): AsyncGenerator<SSEChunk, void, unknown> {
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error ${response.status}: ${error.slice(0, 200)}`);
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
          // 跳过无效 JSON
        }
      }
    }
  }
}