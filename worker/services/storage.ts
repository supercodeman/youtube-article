import type { Session, Article, Chapter, FiveW1H, LogEntry, SessionStatus } from '../types';
import { SESSION_CONFIG } from '../config';

export class StorageService {
  constructor(private kv: KVNamespace) {}

  async saveSession(session: Session): Promise<void> {
    const key = `${SESSION_CONFIG.prefix}${session.id}`;
    await this.kv.put(key, JSON.stringify(session), {
      expirationTtl: SESSION_CONFIG.ttl
    });
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const data = await this.kv.get(`${SESSION_CONFIG.prefix}${sessionId}`);
    return data ? (JSON.parse(data) as Session) : null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.kv.delete(`${SESSION_CONFIG.prefix}${sessionId}`);
  }

  async updateStatus(sessionId: string, status: SessionStatus): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    session.status = status;
    session.updatedAt = Date.now();
    await this.saveSession(session);
    return session;
  }

  async updateArticle(sessionId: string, article: Article): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    session.article = article;
    session.updatedAt = Date.now();
    await this.saveSession(session);
  }

  async save5w1h(sessionId: string, chapterIndex: number, summary: FiveW1H): Promise<Chapter | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    const chapter = session.article.chapters.find(c => c.index === chapterIndex);
    if (!chapter) return null;
    chapter.summary5w1h = summary;
    session.updatedAt = Date.now();
    await this.saveSession(session);
    return chapter;
  }

  async appendLog(sessionId: string, log: LogEntry): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;
    session.logs.push(log);
    if (session.logs.length > 100) {
      session.logs = session.logs.slice(-100);
    }
    await this.saveSession(session);
  }
}