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
- 请分为 ${chapterCount} 个章节
- **必须** 使用 [CHAPTER N: 章节标题] 标记每个章节的开头，N 从 1 开始
  （章节标题文案请用「主题：副标题」风格，如「收入爆发：万亿市场启动」）
- 第一个字符必须是 [CHAPTER 1: ...]
- **章节内容使用对话排版**（基础生成最重要的风格！）：
  - 字幕能识别出多个说话人时（采访/对谈/播客），用真实姓名/角色：「主持人: 」「嘉宾: 」「Mark: 」等
  - 字幕是独白时（演讲/讲解），编一个提问者 + 主讲者一问一答：「主持人: ... 主讲者: ...」
  - 每段对话短而紧凑（2-4 句），避免一个人说一大段
  - 同一章节内可以出现多轮对话
- 不要输出 <think> 块或其他思考过程
- 不要使用 # 或其他 Markdown 标题符号

【示例】
[CHAPTER 1: 收入爆发：万亿市场启动]
主持人: 我们今天要聊的核心话题是什么？
主讲者: 收入增长是真实可验证的，...
主持人: 增长速度有多夸张？
主讲者: 史无前例，...

[CHAPTER 2: 成本塌陷：摩尔定律的胜利]
主持人: 成本端情况怎么样？
主讲者: GPU 价格正在快速下降，...`;
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
