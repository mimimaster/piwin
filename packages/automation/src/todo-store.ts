import type { SessionTodoItem, SessionTodoList } from '@piwin/contracts';

/** In-memory session todos (chat scope). Optional disk later. */
export class SessionTodoStore {
  private readonly bySession = new Map<string, SessionTodoList>();

  get(sessionId: string): SessionTodoList {
    const existing = this.bySession.get(sessionId);
    if (existing) return existing;
    const empty: SessionTodoList = {
      sessionId,
      items: [],
      updatedAt: new Date().toISOString(),
    };
    this.bySession.set(sessionId, empty);
    return empty;
  }

  set(sessionId: string, items: SessionTodoItem[]): SessionTodoList {
    const list: SessionTodoList = {
      sessionId,
      items: items.map((item) => ({
        id: item.id,
        content: item.content,
        status: item.status,
      })),
      updatedAt: new Date().toISOString(),
    };
    this.bySession.set(sessionId, list);
    return list;
  }

  clear(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}
