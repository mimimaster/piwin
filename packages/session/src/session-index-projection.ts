import type { SessionIndexRecord, SessionListOrder } from '@piwin/contracts';
import { filterListableSessions } from './session-display-name.js';

export type SessionIndexProjectionQuery = {
  includeArchived?: boolean;
  order: SessionListOrder;
  /** Transport bound applied after filter + order. Omitted stays unbounded. */
  maxItems?: number;
};

export type SessionIndexProjectionResult = {
  sessions: SessionIndexRecord[];
  /** Filtered, ordered count before truncation. */
  totalCount: number;
  /** True when `sessions.length < totalCount`. */
  truncated: boolean;
};

/**
 * Deterministic global index order shared by full-list and page-list paths.
 *
 * - `updated`: pinned first, then pin/update time descending, then session id.
 * - `alphabetical`: name, then session id. Pins do not affect this order.
 */
export function orderSessionIndexRecords(
  records: readonly SessionIndexRecord[],
  order: SessionListOrder,
): SessionIndexRecord[] {
  return [...records].sort((left, right) => {
    if (order === 'alphabetical') {
      const byName = (left.name ?? '').localeCompare(right.name ?? '');
      return byName !== 0 ? byName : left.id.localeCompare(right.id);
    }

    const leftPinned = left.isPinned === true;
    const rightPinned = right.isPinned === true;
    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }
    if (leftPinned && rightPinned) {
      const byPinnedAt = (right.pinnedAt ?? '').localeCompare(left.pinnedAt ?? '');
      if (byPinnedAt !== 0) {
        return byPinnedAt;
      }
    }
    const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
    return byUpdatedAt !== 0 ? byUpdatedAt : left.id.localeCompare(right.id);
  });
}

/** Filter, order, then optionally truncate a complete session-index projection. */
export function projectSessionIndex(
  records: readonly SessionIndexRecord[],
  query: SessionIndexProjectionQuery,
): SessionIndexProjectionResult {
  validateMaxItems(query.maxItems);
  const lifecycleRecords =
    query.includeArchived === true
      ? records
      : records.filter((record) => record.isArchived !== true);
  const orderedRecords = orderSessionIndexRecords(
    filterListableSessions(lifecycleRecords),
    query.order,
  );
  const totalCount = orderedRecords.length;
  const sessions =
    query.maxItems === undefined ? orderedRecords : orderedRecords.slice(0, query.maxItems);
  return {
    sessions,
    totalCount,
    truncated: sessions.length < totalCount,
  };
}

function validateMaxItems(maxItems: number | undefined): void {
  if (maxItems === undefined) {
    return;
  }
  if (!Number.isSafeInteger(maxItems) || maxItems <= 0) {
    throw new RangeError('Session list maxItems must be a positive safe integer');
  }
}
