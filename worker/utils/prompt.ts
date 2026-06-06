import { SYSTEM_PROMPTS } from '../config';

export function buildArticlePrompt(subtitles: string, requirements?: string): string {
  const req = requirements ? `\n\n【用户要求】\n${requirements}` : '';
  const chapterCount = Math.max(2, Math.min(5, Math.floor(subtitles.length / 300)));

  return `${SYSTEM_PROMPTS.article}

【重要】直接输出最终文章内容，不要输出任何思考过程、思考块、解释或元描述。

【视频字幕】
${subtitles}
${req}

【输出格式 - 严格遵守】
- 请分为 ${chapterCount} 个章节，每章 200-400 字
- **必须** 使用 [CHAPTER N: 章节标题] 标记每个章节的开头，N 从 1 开始
- 第一个字符必须是 [CHAPTER 1: ...]
- 每个章节内容必须紧随 [CHAPTER] 标记之后，不要空行
- 不要输出 <think> 块或其他思考过程
- 不要使用 # 或其他 Markdown 标题符号

【示例】
[CHAPTER 1: 收入爆发]
本章讨论收入增长...

[CHAPTER 2: 成本塌陷]
本章讨论成本下降...`;
}

export function buildSummaryPrompt(
  fullText: string,
  chapterTitle: string,
  chapterContent: string
): string {
  return `${SYSTEM_PROMPTS.summary}

【整篇文章摘要】
${fullText.slice(0, 2000)}

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
}