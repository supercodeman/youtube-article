import type { ParserEvent } from '../types';

const CHAPTER_REGEX = /\[CHAPTER\s+(\d+):\s*([^\]]+)\]/;

export interface ParserState {
  currentChapterIndex: number;
  currentChapterTitle: string;
  currentChapterStart: number;
  accumulatedText: string;
}

export function createParserState(): ParserState {
  return {
    currentChapterIndex: -1,
    currentChapterTitle: '',
    currentChapterStart: 0,
    accumulatedText: ''
  };
}

export function parseChunk(
  chunk: string,
  state: ParserState
): { events: ParserEvent[]; text: string; newState: ParserState } {
  const events: ParserEvent[] = [];
  let text = '';

  // 检查是否是章节标记
  const match = chunk.match(CHAPTER_REGEX);
  if (match) {
    const index = parseInt(match[1], 10) - 1; // 转为 0-based
    const title = match[2].trim();

    // 先输出累积的文本（属于上一章）
    if (state.currentChapterIndex >= 0 && state.accumulatedText) {
      events.push({
        type: 'text',
        content: state.accumulatedText
      });
      text += state.accumulatedText;
    }

    // 新章节开始
    events.push({
      type: 'chapter',
      index,
      title,
      startIndex: 0 // 将在累积后校准
    });

    // 更新状态
    state.currentChapterIndex = index;
    state.currentChapterTitle = title;
    state.currentChapterStart = 0;
    state.accumulatedText = '';
  } else {
    // 普通文本，累积到当前章节
    state.accumulatedText += chunk;
    text += chunk;
  }

  return { events, text, newState: state };
}
