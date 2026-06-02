import type { Session, Article, Chapter, FiveW1H, LogEntry } from '../types';

const SESSION_PREFIX = 'session:';
const SESSION_TTL = 86400; // 24小时

export class StorageService {
  constructor(private kv: KVNamespace) {}

  async saveSession(session: Session): Promise<void> {
    const key = `${SESSION_PREFIX}${session.id}`;
    await this.kv.put(key, JSON.stringify(session), {
      expirationTtl: SESSION_TTL
    });
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const key = `${SESSION_PREFIX}${sessionId}`;
    const data = await this.kv.get(key);
    if (!data) return null;
    return JSON.parse(data) as Session;
  }

  async updateArticle(sessionId: string, article: Article): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    session.article = article;
    session.updatedAt = Date.now();
    await this.saveSession(session);
  }

  async updateChapter(sessionId: string, chapter: Chapter): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    const existingIndex = session.article.chapters.findIndex(c => c.index === chapter.index);
    if (existingIndex >= 0) {
      session.article.chapters[existingIndex] = chapter;
    } else {
      session.article.chapters.push(chapter);
      session.article.chapters.sort((a, b) => a.index - b.index);
    }
    session.updatedAt = Date.now();
    await this.saveSession(session);
  }

  async save5w1h(sessionId: string, chapterIndex: number, summary: FiveW1H): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    const chapter = session.article.chapters.find(c => c.index === chapterIndex);
    if (!chapter) throw new Error('Chapter not found');
    chapter.summary5w1h = summary;
    session.updatedAt = Date.now();
    await this.saveSession(session);
  }

  async updateStatus(sessionId: string, status: Session['status']): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    session.status = status;
    session.updatedAt = Date.now();
    await this.saveSession(session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const key = `${SESSION_PREFIX}${sessionId}`;
    await this.kv.delete(key);
  }

  async addLog(sessionId: string, log: LogEntry): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    session.logs.push(log);
    if (session.logs.length > 100) {
      session.logs = session.logs.slice(-100);
    }
    session.updatedAt = Date.now();
    await this.saveSession(session);
  }
}