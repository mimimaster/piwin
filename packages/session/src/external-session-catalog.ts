/**
 * Merge an external agent's session catalog into the product session index
 * (ADR 0082). The external catalog is authoritative for existence and title
 * of that agent's sessions; piwin-only fields (pin, archive, preview) are kept.
 */

import type { SessionIndexRecord } from '@piwin/contracts';
import { withFileWriteLock } from './file-write-lock.js';
import { loadSessionIndex, saveSessionIndex } from './session-index-store.js';

export type ExternalCatalogEntry = {
  backendSessionId: string;
  title?: string;
  cwd?: string;
  lastChangeUnixMs?: number;
};

export type ExternalCatalogSyncInput = {
  indexPath: string;
  agentId: string;
  entries: readonly ExternalCatalogEntry[];
  /** Product id for a newly discovered external session. */
  createProductSessionId: () => string;
  /** Map an external cwd onto a product project path ('' = general scope). */
  resolveProjectPath: (cwd: string | undefined) => string;
  now?: () => Date;
};

export type ExternalCatalogSyncResult = {
  created: SessionIndexRecord[];
  updated: SessionIndexRecord[];
  /** Records whose external session disappeared (deleted in the agent). */
  removed: SessionIndexRecord[];
};

export async function syncExternalSessionCatalog(
  input: ExternalCatalogSyncInput,
): Promise<ExternalCatalogSyncResult> {
  const now = input.now ?? (() => new Date());
  return withFileWriteLock(input.indexPath, async () => {
    const document = await loadSessionIndex(input.indexPath);
    const byBackendId = new Map<string, SessionIndexRecord>();
    for (const record of document.sessions) {
      if (record.backend?.agentId === input.agentId && record.backend.backendSessionId) {
        byBackendId.set(record.backend.backendSessionId, record);
      }
    }
    const result: ExternalCatalogSyncResult = { created: [], updated: [], removed: [] };
    const seen = new Set<string>();
    for (const entry of input.entries) {
      seen.add(entry.backendSessionId);
      const existing = byBackendId.get(entry.backendSessionId);
      const updatedAt =
        entry.lastChangeUnixMs !== undefined
          ? new Date(entry.lastChangeUnixMs).toISOString()
          : now().toISOString();
      if (existing === undefined) {
        const projectPath = input.resolveProjectPath(entry.cwd);
        const record: SessionIndexRecord = {
          id: input.createProductSessionId(),
          projectPath,
          scope: projectPath === '' ? { kind: 'general' } : { kind: 'project', projectPath },
          ...(entry.cwd !== undefined ? { workingDirectory: entry.cwd } : {}),
          createdAt: updatedAt,
          updatedAt,
          messageCount: 0,
          kind: 'main',
          backend: { agentId: input.agentId, backendSessionId: entry.backendSessionId },
          ...(entry.title !== undefined ? { name: entry.title, nameSource: 'llm' as const } : {}),
        };
        document.sessions.unshift(record);
        result.created.push(record);
        continue;
      }
      let changed = false;
      if (entry.title !== undefined && existing.nameSource !== 'user' && existing.name !== entry.title) {
        existing.name = entry.title;
        existing.nameSource = 'llm';
        changed = true;
      }
      if (updatedAt > existing.updatedAt) {
        existing.updatedAt = updatedAt;
        changed = true;
      }
      if (changed) {
        result.updated.push(existing);
      }
    }
    const kept: SessionIndexRecord[] = [];
    for (const record of document.sessions) {
      const backendSessionId = record.backend?.backendSessionId;
      if (
        record.backend?.agentId === input.agentId &&
        backendSessionId !== undefined &&
        !seen.has(backendSessionId)
      ) {
        result.removed.push(record);
        continue;
      }
      kept.push(record);
    }
    document.sessions = kept;
    if (result.created.length + result.updated.length + result.removed.length > 0) {
      await saveSessionIndex(input.indexPath, document);
    }
    return result;
  });
}
