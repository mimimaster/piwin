import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import type { MemoryScope, MemoryType } from '@piwin/contracts';

export function getMemoryRoot(piwinRoot: string): string {
  return join(piwinRoot, 'memory');
}

export function getOverviewCacheDir(memoryRoot: string): string {
  return join(memoryRoot, '.overview-cache');
}

/**
 * Stable project key from absolute project path (filesystem-safe).
 * Used for `~/.piwin/memory/projects/<key>/` isolation.
 */
export function projectKeyFromPath(projectPath: string): string {
  const absolute = resolve(projectPath);
  const hash = createHash('sha256').update(absolute).digest('hex').slice(0, 16);
  const base = absolute
    .replace(/[:/\\]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^-+|-+$/g, '')
    .slice(-48);
  return base ? `${base}-${hash}` : hash;
}

/**
 * Reject path traversal: target must stay under memoryRoot.
 */
export function assertInsideMemoryRoot(memoryRoot: string, absolutePath: string): string {
  const root = resolve(memoryRoot);
  const target = resolve(absolutePath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`path escapes memory root: ${absolutePath}`);
  }
  return target;
}

export function relativeDirForEntry(input: {
  scope: MemoryScope;
  projectKey?: string;
  type: MemoryType;
  dayStamp?: string;
}): string {
  if (input.type === 'daily') {
    const day = input.dayStamp ?? new Date().toISOString().slice(0, 10);
    return join('daily', day);
  }
  if (input.scope === 'project') {
    if (!input.projectKey || input.projectKey.trim().length === 0) {
      throw new Error('projectKey required for project-scoped memory');
    }
    sanitizePathSegment(input.projectKey, 'projectKey');
    return join('projects', input.projectKey);
  }
  return 'global';
}

export function sanitizePathSegment(value: string, label: string): string {
  if (!value || value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Error(`invalid ${label}: path traversal rejected`);
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`invalid ${label}: unsafe characters`);
  }
  return value;
}

export function memoryFileName(id: string): string {
  sanitizePathSegment(id, 'memory id');
  return `${id}.md`;
}
