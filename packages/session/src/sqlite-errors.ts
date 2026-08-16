/**
 * Split from transcript-store.ts — pure relocation, no behavior change.
 */

import type { DatabaseSync } from 'node:sqlite';

export function rollback(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK');
  } catch {
    // Preserve the original database error; a failed rollback is secondary.
  }
}

export function isSqliteUniqueConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as Record<string, unknown>;
  return (
    record.errcode === 1555 ||
    record.errcode === 2067 ||
    (typeof record.message === 'string' && record.message.includes('UNIQUE constraint failed'))
  );
}
