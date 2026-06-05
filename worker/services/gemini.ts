import type { SSEChunk } from '../types';

const BASE_URL = 'https://api.minimax.chat/v1';
const MODEL = 'MiniMax-M2.7';

export class GeminiService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  buildPrompt(subtitles: string, requirements?: string): string {
    const req = requirements ? `\n\n【用户要求】\n${requirements}` : '';

    // 根据字幕长度决定章节数
    const chapterCount = Math.max(2, Math.min(5, Math.floor(subtitles.length / 300)));
    const chapterHint = `请分为 ${chapterCount} 个章节`;

    return `你是一个专业的视频内容分析师。请根据以下字幕内容，生成一篇结构清晰的中文文章。

【视频字幕】
${subtitles}
${req}

【输出格式 - 严格遵守】
- ${chapterHint}，每章 200-400 字
- **必须** 使用 [CHAPTER N: 章节标题] 标记每个章节的开头，N 从 1 开始
- 第一个字符必须是 [CHAPTER 1: ...]
- 每个章节内容必须紧随 [CHAPTER] 标记之后，不要空行
- 语言简洁有力，适合阅读
- 不要在章节内容中重复章节标题
- 不要使用 # 或其他 Markdown 标题符号

【示例】
[CHAPTER 1: 收入爆发]
本章讨论收入增长...

[CHAPTER 2: 成本塌陷]
本章讨论成本下降...`;
  }

  async *generateStream(
    subtitles: string,
    requirements?: string
  ): AsyncGenerator<SSEChunk, void, unknown> {
    const prompt = this.buildPrompt(subtitles, requirements);

    try {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          stream: true
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`MiniMax API error: ${response.status} ${error}`);
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
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield { type: 'text', content };
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
        }
      }
    } catch (e) {
      throw new Error(`Stream error: ${e}`);
    }
  }

  async generateSummary(
    articleContent: string,
    chapterTitle: string,
    chapterContent: string
  ): Promise<{ who: string; what: string; when: string; where: string; why: string; how: string }> {
    const prompt = `基于以下视频文章内容，为指定章节生成 5W1H 总结。

【整篇文章摘要】
${articleContent.slice(0, 2000)}...

【指定章节】
标题：${chapterTitle}
内容：${chapterContent.slice(0, 1500)}

【输出格式】
请严格按以下 JSON 格式返回，不要包含任何其他内容：
{
  "who": "人物或主体",
  "what": "事件或内容",
  "when": "时间或阶段",
  "where": "地点或场景",
  "why": "原因或动机",
  "how": "方式或方法"
}`;

    try {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`MiniMax API error: ${response.status} - ${error.slice(0, 200)}`);
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content || '';

      if (!text) {
        throw new Error('Empty response from MiniMax API');
      }

      const jsonMatch = text.match(/\{[\s\S]*?"who"[\s\S]*?\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error(`Failed to parse 5W1H response: ${text.slice(0, 100)}`);
    } catch (e) {
      throw new Error(`Summary generation error: ${e}`);
    }
  }
}
