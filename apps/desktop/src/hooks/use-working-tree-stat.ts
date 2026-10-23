/**
 * Working-tree line counts for a project, refreshed on window focus and after
 * branch/checkout changes. Null for a clean tree or when git cannot answer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitDiffSummary, HostResponse } from '@piwin/contracts';
import { PROJECT_SIDEBAR_GIT_CHANGED } from '../sidebar/project-sidebar-events';

export type WorkingTreeStat = { additions: number; deletions: number };

export type WorkingTreeStatRequest = {
  type: 'git/diff-summary';
  projectPath: string;
};

export function useWorkingTreeStat(
  projectPath: string | null,
  request: (command: WorkingTreeStatRequest) => Promise<HostResponse>,
): WorkingTreeStat | null {
  const [stat, setStat] = useState<WorkingTreeStat | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;
  const sequence = useRef(0);

  const reload = useCallback(async () => {
    const current = ++sequence.current;
    if (!projectPath) {
      setStat(null);
      return;
    }
    const response = await requestRef.current({ type: 'git/diff-summary', projectPath });
    if (current !== sequence.current) return;
    const summary = response.success
      ? (response.data as { summary?: GitDiffSummary } | undefined)?.summary
      : undefined;
    setStat(
      summary && summary.totalAdditions + summary.totalDeletions > 0
        ? { additions: summary.totalAdditions, deletions: summary.totalDeletions }
        : null,
    );
  }, [projectPath]);

  useEffect(() => {
    void reload();
    const refresh = (): void => {
      void reload();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener(PROJECT_SIDEBAR_GIT_CHANGED, refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener(PROJECT_SIDEBAR_GIT_CHANGED, refresh);
    };
  }, [reload]);

  return stat;
}
