import type { SessionSummary } from '@piwin/contracts';
import type { SessionListItemUi } from '../chat-reducer';

export function summaryToListItem(
  session: SessionSummary,
  fallbackId: string,
): SessionListItemUi {
  const item: SessionListItemUi = {
    id: session.id || fallbackId,
    // Prefer real name; empty string stays unlistable (sidebar policy).
    name: session.name?.trim() || '',
  };
  if (session.lastPreview) item.lastPreview = session.lastPreview;
  if (typeof session.messageCount === 'number') item.messageCount = session.messageCount;
  if (session.updatedAt) item.updatedAt = session.updatedAt;
  if (session.isPinned === true) item.isPinned = true;
  if (session.pinnedAt) item.pinnedAt = session.pinnedAt;
  if (session.isArchived === true) item.isArchived = true;
  if (session.archivedAt) item.archivedAt = session.archivedAt;
  if (session.origin) item.origin = session.origin;
  if (session.model) item.model = session.model;
  if (session.thinkingLevel !== undefined) item.thinkingLevel = session.thinkingLevel;
  if (session.scope) item.scope = session.scope;
  if (session.storage && session.storage.state !== 'local') item.storage = session.storage;
  return item;
}

export function mapSummariesToListItems(
  sessions: SessionSummary[],
): SessionListItemUi[] {
  return sessions.map((session) => ({
    id: session.id,
    name: session.name?.trim() || '',
    ...(session.lastPreview ? { lastPreview: session.lastPreview } : {}),
    messageCount: session.messageCount,
    updatedAt: session.updatedAt,
    ...(session.isPinned === true ? { isPinned: true } : {}),
    ...(session.pinnedAt ? { pinnedAt: session.pinnedAt } : {}),
    ...(session.isArchived === true ? { isArchived: true } : {}),
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
    ...(session.origin ? { origin: session.origin } : {}),
    ...(session.model ? { model: session.model } : {}),
    ...(session.thinkingLevel !== undefined
      ? { thinkingLevel: session.thinkingLevel }
      : {}),
    ...(session.scope ? { scope: session.scope } : {}),
    ...(session.storage && session.storage.state !== 'local' ? { storage: session.storage } : {}),
  }));
}
