import type { SessionSummary } from '@piwin/contracts';
import type { SessionListItemUi } from '../chat-reducer';

export function summaryToListItem(
  session: SessionSummary,
  fallbackId: string,
): SessionListItemUi {
  const item: SessionListItemUi = {
    id: session.id || fallbackId,
    name: session.name ?? `session-${fallbackId.slice(0, 8)}`,
  };
  if (session.lastPreview) item.lastPreview = session.lastPreview;
  if (typeof session.messageCount === 'number') item.messageCount = session.messageCount;
  if (session.updatedAt) item.updatedAt = session.updatedAt;
  if (session.isPinned === true) item.isPinned = true;
  if (session.pinnedAt) item.pinnedAt = session.pinnedAt;
  if (session.isArchived === true) item.isArchived = true;
  if (session.archivedAt) item.archivedAt = session.archivedAt;
  return item;
}

export function mapSummariesToListItems(
  sessions: SessionSummary[],
): SessionListItemUi[] {
  return sessions.map((session) => ({
    id: session.id,
    name: session.name ?? `session-${session.id.slice(0, 8)}`,
    ...(session.lastPreview ? { lastPreview: session.lastPreview } : {}),
    messageCount: session.messageCount,
    updatedAt: session.updatedAt,
    ...(session.isPinned === true ? { isPinned: true } : {}),
    ...(session.pinnedAt ? { pinnedAt: session.pinnedAt } : {}),
    ...(session.isArchived === true ? { isArchived: true } : {}),
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
  }));
}
