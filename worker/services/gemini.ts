import { GoogleGenerativeAI, GenerateContentStreamResult } from '@google/generative-ai';
import type { SSEChunk } from '../types';

export class GeminiService {
  private model;

  constructor(apiKey: string) {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  buildPrompt(subtitles: string, requirements?: string): string {
    const req = requirements ? `\n\n【用户要求】\n${requirements}` : '';
    return `你是一个专业的视频内容分析师。请根据以下字幕内容，生成一篇结构清晰的中文文章。

【视频字幕】
${subtitles}
${req}

【输出格式】
- 文章分章节，每章 500-800 字
- 使用 [CHAPTER N: 章节标题] 标记章节开头（N 从 1 开始）
- 语言简洁有力，适合阅读
- 不要在章节内容中重复章节标题`;
  }

  async *generateStream(
    subtitles: string,
    requirements?: string
  ): AsyncGenerator<SSEChunk, void, unknown> {
    const prompt = this.buildPrompt(subtitles, requirements);
    let result: GenerateContentStreamResult;

    try {
      result = await this.model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
    } catch (e) {
      throw new Error(`Gemini API error: ${e}`);
    }

    try {
      for await (const chunk of result.stream) {
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text) {
          yield { type: 'text', content: text };
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
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });

      const text = result.response.text();
      // 尝试解析 JSON
      const jsonMatch = text.match(/\{[\s\S]*?"who"[\s\S]*?\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Failed to parse 5W1H response');
    } catch (e) {
      throw new Error(`Summary generation error: ${e}`);
    }
  }
}