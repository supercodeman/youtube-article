import type { ParserEvent } from '../types';

const CHAPTER_REGEX = /\[CHAPTER\s+(\d+):\s*([^\]]+)\]/g;
const THINK_REGEX = /<think>[\s\S]*?(<\/think>|$)/g;
const MAX_BUFFER = 10000;

export interface ParserState {
  buffer: string;
  currentChapterIndex: number;
  currentChapterTitle: string;
  seenChapterIndices: Set<number>;
}

export function createParserState(): ParserState {
  return {
    buffer: '',
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

  // 累积到 buffer
  state.buffer += chunk;

  // 移除 thinking 块（包括不完整的跨 chunk 部分）
  state.buffer = state.buffer.replace(THINK_REGEX, '');

  // 在 buffer 中查找所有完整的 [CHAPTER N: title] 标记
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  const re = new RegExp(CHAPTER_REGEX.source, 'g');

  while ((match = re.exec(state.buffer)) !== null) {
    const before = state.buffer.substring(lastIndex, match.index);

    // 标记前的内容作为 text 事件
    if (before) {
      events.push({ type: 'text', content: before });
    }

    // 解析章节
    const index = parseInt(match[1], 10) - 1; // 转为 0-based
    const title = match[2].trim();

    if (!state.seenChapterIndices.has(index)) {
      state.seenChapterIndices.add(index);
      events.push({
        type: 'chapter',
        index,
        title,
        startIndex: 0
      });
    }

    state.currentChapterIndex = index;
    state.currentChapterTitle = title;
    lastIndex = re.lastIndex;
  }

  // 保留未匹配的部分在 buffer 中
  state.buffer = state.buffer.substring(lastIndex);

  // 防止 buffer 无限增长：超过阈值时强制 flush
  if (state.buffer.length > MAX_BUFFER) {
    events.push({ type: 'text', content: state.buffer });
    state.buffer = '';
  }

  return { events, newState: state };
}

// 流结束时调用，flush 剩余 buffer
export function flushBuffer(state: ParserState): { events: ParserEvent[]; newState: ParserState } {
  const events: ParserEvent[] = [];
  if (state.buffer) {
    events.push({ type: 'text', content: state.buffer });
    state.buffer = '';
  }
  return { events, newState: state };
}