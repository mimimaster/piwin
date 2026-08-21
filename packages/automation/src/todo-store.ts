import { createHash } from 'node:crypto';
import type { SessionTodoItem, SessionTodoList } from '@piwin/contracts';

export function createTodoListRevision(items: readonly SessionTodoItem[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        items.map((item) => ({ id: item.id, content: item.content, status: item.status })),
      ),
    )
    .digest('hex');
}

/** In-memory session todos (chat scope). Optional disk later. */
export class SessionTodoStore {
  private readonly bySession = new Map<string, SessionTodoList>();

  get(sessionId: string): SessionTodoList {
    const existing = this.bySession.get(sessionId);
    if (existing) return existing;
    const empty = createTodoList(sessionId, []);
    this.bySession.set(sessionId, empty);
    return empty;
  }

  set(sessionId: string, items: SessionTodoItem[]): SessionTodoList {
    const list = createTodoList(sessionId, items);
    this.bySession.set(sessionId, list);
    return list;
  }

  clear(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}

function createTodoList(sessionId: string, items: SessionTodoItem[]): SessionTodoList {
  const normalized = items.map((item) => ({
    id: item.id,
    content: item.content,
    status: item.status,
  }));
  return {
    sessionId,
    items: normalized,
    updatedAt: new Date().toISOString(),
    revision: createTodoListRevision(normalized),
  };
}
