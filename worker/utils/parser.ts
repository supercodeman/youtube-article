import type { ParserEvent } from '../types';

const CHAPTER_REGEX = /\[CHAPTER\s+(\d+):\s*([^\]]+)\]/;
const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';
const MAX_BUFFER = 10000;

export interface ParserState {
  buffer: string;
  inThinking: boolean;
  currentChapterIndex: number;
  currentChapterTitle: string;
  seenChapterIndices: Set<number>;
}

export function createParserState(): ParserState {
  return {
    buffer: '',
    inThinking: false,
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

  // 状态机：处理 thinking 块和 chapter 标记
  let processing = true;
  while (processing) {
    if (state.inThinking) {
      // 在 thinking 块中，查找 close
      const closeIdx = state.buffer.indexOf(THINK_CLOSE);
      if (closeIdx === -1) {
        // 还没看到 close，等待更多 chunk
        processing = false;
      } else {
        // 找到 close，移除整个 thinking 块
        state.buffer = state.buffer.substring(closeIdx + THINK_CLOSE.length);
        state.inThinking = false;
        // 继续处理剩余 buffer
      }
    } else {
      // 不在 thinking 中
      const openIdx = state.buffer.indexOf(THINK_OPEN);

      if (openIdx === -1) {
        // 没有 thinking 块开始，处理 chapter
        processing = processChapters(state, events);
      } else {
        // 找到 <think> 开头
        const before = state.buffer.substring(0, openIdx);
        if (before) {
          events.push({ type: 'text', content: before });
        }
        state.buffer = state.buffer.substring(openIdx + THINK_OPEN.length);
        state.inThinking = true;
        // 继续循环，处理 thinking 块
      }
    }
  }

  // 防止 buffer 无限增长
  if (state.buffer.length > MAX_BUFFER) {
    events.push({ type: 'text', content: state.buffer });
    state.buffer = '';
  }

  return { events, newState: state };
}

function processChapters(state: ParserState, events: ParserEvent[]): boolean {
  const match = state.buffer.match(CHAPTER_REGEX);
  if (!match || match.index === undefined) {
    return false; // 停止处理
  }

  const before = state.buffer.substring(0, match.index);
  const after = state.buffer.substring(match.index + match[0].length);

  // 标记前的内容作为 text 事件
  if (before) {
    events.push({ type: 'text', content: before });
  }

  // 解析章节
  const index = parseInt(match[1], 10) - 1;
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
  state.buffer = after;

  return true; // 继续查找更多 chapter
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