import type { ParserEvent } from '../types';

const CHAPTER_REGEX = /\[CHAPTER\s+(\d+):\s*([^\]]+)\]/;

export interface ParserState {
  currentChapterIndex: number;
  currentChapterTitle: string;
  seenChapterIndices: Set<number>;
}

export function createParserState(): ParserState {
  return {
    currentChapterIndex: -1,
    currentChapterTitle: '',
    seenChapterIndices: new Set()
  };
}

export function parseChunk(
  chunk: string,
  state: ParserState
): { events: ParserEvent[]; newState: ParserState } {
  const events: ParserEvent[] = [];

  // 检查是否是章节标记
  const match = chunk.match(CHAPTER_REGEX);
  if (match) {
    const index = parseInt(match[1], 10) - 1; // 转为 0-based
    const title = match[2].trim();

    // 检查是否重复章节
    if (state.seenChapterIndices.has(index)) {
      return { events, newState: state };
    }

    // 新章节开始
    state.seenChapterIndices.add(index);
    events.push({
      type: 'chapter',
      index,
      title,
      startIndex: 0
    });

    state.currentChapterIndex = index;
    state.currentChapterTitle = title;
  } else {
    // 普通文本，立即作为 text 事件发出
    if (chunk) {
      events.push({
        type: 'text',
        content: chunk
      });
    }
  }

  return { events, newState: state };
}