import type { SessionSummary } from '@piwin/contracts';
import { mapListedSessionItems } from '../../remote-session-hydrate';

/**
 * Archive Management reads `session/list` directly. Local Host returns
 * `id` + `isArchived`; remote projection returns `sessionId` + `archived`.
 * Map both before filtering so archived rows are not dropped as empty.
 */
export function archivedSessionsFromListData(data: unknown): SessionSummary[] {
  const mapped = mapListedSessionItems(data);
  const archived: SessionSummary[] = [];
  for (const item of mapped.sessions) {
    if (item.isArchived !== true) {
      continue;
    }
    const scope = item.scope ?? { kind: 'general' as const };
    const projectPath = scope.kind === 'project' ? scope.projectPath : '';
    const summary: SessionSummary = {
      id: item.id,
      scope,
      workingDirectory: projectPath,
      projectPath,
      updatedAt: item.updatedAt ?? '',
      messageCount: item.messageCount ?? 0,
      isArchived: true,
    };
    if (item.name) summary.name = item.name;
    if (item.lastPreview) summary.lastPreview = item.lastPreview;
    if (item.archivedAt) summary.archivedAt = item.archivedAt;
    if (item.isPinned === true) summary.isPinned = true;
    archived.push(summary);
  }
  return archived;
}