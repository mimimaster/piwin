import { join, resolve, sep } from 'node:path';

export function getNotesRoot(piwinRoot: string): string {
  return join(piwinRoot, 'notes');
}

export function getIndexPath(notesRoot: string): string {
  return join(notesRoot, '.index', 'notes-index.sqlite3');
}

export const DEFAULT_COLLECTION = 'default';

/** Reject path traversal: target must stay under notesRoot. */
export function assertInsideNotesRoot(notesRoot: string, absolutePath: string): string {
  const root = resolve(notesRoot);
  const target = resolve(absolutePath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`path escapes notes root: ${absolutePath}`);
  }
  return target;
}

export function sanitizePathSegment(value: string, label: string): string {
  if (!value || value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Error(`invalid ${label}: path traversal rejected`);
  }
  if (!/^[a-zA-Z0-9._\u4e00-\u9fff-]+$/.test(value)) {
    throw new Error(`invalid ${label}: unsafe characters`);
  }
  return value;
}

export function noteFileName(id: string): string {
  sanitizePathSegment(id, 'note id');
  return `${id}.md`;
}
