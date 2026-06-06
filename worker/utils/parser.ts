import type { ParserEvent } from '../types';

const CHAPTER_REGEX = /\[CHAPTER\s+(\d+):\s*([^\]]+)\]/;
const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';
const MAX_BUFFER = 10000;

export interface ParserState {
  buffer: string;
  inThinking: boolean;
  currentChapterIndex: number;
  seenChapterIndices: Set<number>;
}

export function createParserState(): ParserState {
  return {
    buffer: '',
    inThinking: false,
    currentChapterIndex: -1,
    seenChapterIndices: new Set()
  };
}

export function parseChunk(
  chunk: string,
  state: ParserState
): { events: ParserEvent[]; newState: ParserState } {
  const events: ParserEvent[] = [];
  state.buffer += chunk;

  // 状态机：处理 thinking 块和 chapter 标记
  let processing = true;
  while (processing) {
    if (state.inThinking) {
      const closeIdx = state.buffer.indexOf(THINK_CLOSE);
      if (closeIdx === -1) {
        processing = false; // 等待更多 chunk
      } else {
        state.buffer = state.buffer.substring(closeIdx + THINK_CLOSE.length);
        state.inThinking = false;
      }
    } else {
      const openIdx = state.buffer.indexOf(THINK_OPEN);
      if (openIdx === -1) {
        processing = processChapters(state, events);
      } else {
        const before = state.buffer.substring(0, openIdx);
        if (before) {
          events.push({ type: 'text', content: before });
        }
        state.buffer = state.buffer.substring(openIdx + THINK_OPEN.length);
        state.inThinking = true;
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
    return false;
  }

  const before = state.buffer.substring(0, match.index);
  const after = state.buffer.substring(match.index + match[0].length);

  if (before) {
    events.push({ type: 'text', content: before });
  }

  const index = parseInt(match[1], 10) - 1;
  const title = match[2].trim();

  if (!state.seenChapterIndices.has(index)) {
    state.seenChapterIndices.add(index);
    events.push({ type: 'chapter', index, title, startIndex: 0 });
  }

  state.currentChapterIndex = index;
  state.buffer = after;
  return true;
}

export function flushBuffer(state: ParserState): { events: ParserEvent[]; newState: ParserState } {
  const events: ParserEvent[] = [];
  if (state.buffer.trim()) {
    events.push({ type: 'text', content: state.buffer });
  }
  state.buffer = '';
  return { events, newState: state };
}