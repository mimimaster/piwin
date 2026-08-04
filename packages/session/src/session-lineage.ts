/**
 * SF-04: Product session lineage query.
 *
 * Builds a ProductSessionLineageView by scanning the session index for all
 * sessions sharing the same rootSessionId (including the root itself).
 * The root may be missing if it was permanently deleted; surviving forks
 * remain valid and are included.
 */
import type {
  ProductSessionLineageNode,
  ProductSessionLineageView,
  SessionIndexRecord,
} from '@piwin/contracts';
import { listAllSessionRecords, getSessionRecord } from './session-index-store.js';

export type SessionLineagePaths = {
  indexPath: string;
};

/**
 * Resolve the root session ID for a given session.
 * - A session with fork origin: use origin.rootSessionId.
 * - A session with no origin: it is its own root.
 * - A session with duplicate origin: it is its own root (duplicates don't join lineage).
 */
function resolveRootId(record: SessionIndexRecord): string {
  if (record.origin?.kind === 'fork') {
    return record.origin.rootSessionId;
  }
  return record.id;
}

function toLineageNode(record: SessionIndexRecord): ProductSessionLineageNode {
  return {
    sessionId: record.id,
    ...(record.name ? { name: record.name } : {}),
    ...(record.origin ? { origin: record.origin } : {}),
    isArchived: record.isArchived === true,
    updatedAt: record.updatedAt,
  };
}

export async function getSessionLineage(
  paths: SessionLineagePaths,
  sessionId: string,
): Promise<ProductSessionLineageView> {
  // First, find the target session to determine its root.
  const targetRecord = await getSessionRecord(paths.indexPath, sessionId);
  if (!targetRecord) {
    // Session doesn't exist in index; return empty lineage with rootMissing.
    return {
      rootSessionId: sessionId,
      activeSessionId: sessionId,
      rootMissing: true,
      nodes: [],
    };
  }

  const rootSessionId = resolveRootId(targetRecord);

  // Scan all records for sessions with the same root.
  const allRecords = await listAllSessionRecords(paths.indexPath);
  const relatedNodes: ProductSessionLineageNode[] = [];
  let rootFound = false;

  for (const record of allRecords) {
    const recordRootId = resolveRootId(record);
    if (recordRootId === rootSessionId) {
      if (record.id === rootSessionId) {
        rootFound = true;
      }
      relatedNodes.push(toLineageNode(record));
    }
  }

  // If the root was not found in the index (permanently deleted), check.
  if (!rootFound) {
    const rootRecord = await getSessionRecord(paths.indexPath, rootSessionId);
    if (rootRecord) {
      rootFound = true;
      // The root might not have fork origin, so resolveRootId returns its own id.
      // It should already be in relatedNodes, but double-check.
      if (!relatedNodes.some((node) => node.sessionId === rootSessionId)) {
        relatedNodes.push(toLineageNode(rootRecord));
      }
    }
  }

  // Sort: root first, then by updatedAt descending.
  relatedNodes.sort((a, b) => {
    if (a.sessionId === rootSessionId) return -1;
    if (b.sessionId === rootSessionId) return 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return {
    rootSessionId,
    activeSessionId: sessionId,
    rootMissing: !rootFound,
    nodes: relatedNodes,
  };
}

/**
 * Count direct forks of a session (sessions whose origin.sourceSessionId
 * matches the given sessionId and origin.kind is 'fork').
 */
export function countDirectForks(records: SessionIndexRecord[], sessionId: string): number {
  return records.filter(
    (record) =>
      record.origin?.kind === 'fork' &&
      record.origin.sourceSessionId === sessionId,
  ).length;
}

/**
 * Get the names of existing direct forks for collision-avoidance in naming.
 */
export function getDirectForkNames(
  records: SessionIndexRecord[],
  sessionId: string,
): string[] {
  return records
    .filter(
      (record) =>
        record.origin?.kind === 'fork' &&
        record.origin.sourceSessionId === sessionId,
    )
    .map((record) => record.name ?? '')
    .filter((name) => name.length > 0);
}
