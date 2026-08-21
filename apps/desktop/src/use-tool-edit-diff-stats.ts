import { useEffect, useState } from 'react';
import type { GitFileDiff } from '@piwin/contracts';
import { diffLineStats, type DiffCardRequest } from './diff-card';

export type ToolEditDiffStats = { added: number; removed: number };

const statsCache = new Map<string, ToolEditDiffStats>();

function cacheKey(projectPath: string, path: string): string {
  return `${projectPath}\0${path}`;
}

function statsFromFileDiff(fileDiff: GitFileDiff): ToolEditDiffStats | undefined {
  if (typeof fileDiff.additions === 'number' || typeof fileDiff.deletions === 'number') {
    return {
      added: fileDiff.additions ?? 0,
      removed: fileDiff.deletions ?? 0,
    };
  }
  if (!fileDiff.patch) {
    return undefined;
  }
  const parsed = diffLineStats(fileDiff.patch);
  if (parsed.adds === 0 && parsed.dels === 0) {
    return undefined;
  }
  return { added: parsed.adds, removed: parsed.dels };
}

export function useToolEditDiffStats(input: {
  enabled: boolean;
  projectPath: string | null | undefined;
  path: string | undefined;
  request: DiffCardRequest | undefined;
  fallback: ToolEditDiffStats | undefined;
}): ToolEditDiffStats | undefined {
  const projectPath = input.projectPath ?? null;
  const path = input.path;
  const cacheId = input.enabled && projectPath && path ? cacheKey(projectPath, path) : '';
  const cached = cacheId ? statsCache.get(cacheId) : undefined;
  const [fetched, setFetched] = useState<ToolEditDiffStats | undefined>(cached);

  useEffect(() => {
    if (!input.enabled || !projectPath || !path || !input.request) {
      return;
    }
    const key = cacheKey(projectPath, path);
    const existing = statsCache.get(key);
    if (existing) {
      setFetched(existing);
      return;
    }
    let cancelled = false;
    void input
      .request({
        type: 'git/diff-file',
        projectPath,
        path,
        scope: 'combined',
      })
      .then((response) => {
        if (cancelled || !response.success) {
          return;
        }
        const fileDiff = (response.data as { diff?: GitFileDiff } | undefined)?.diff;
        if (!fileDiff) {
          return;
        }
        const next = statsFromFileDiff(fileDiff);
        if (!next) {
          return;
        }
        statsCache.set(key, next);
        setFetched(next);
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [input.enabled, input.request, path, projectPath]);

  return fetched ?? input.fallback;
}

export function clearToolEditDiffStatsCacheForTests(): void {
  statsCache.clear();
}
