/**
 * Working-tree state for the Changes panel: `git/status` + `git/diff-summary`
 * merged into rows, plus the stage / unstage / commit mutations. `revision`
 * bumps on every completed load so open diff sections know to refetch.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GitDiffSummary, GitStatusSnapshot, HostResponse } from '@piwin/contracts';
import { buildChangeRows, type ChangeRow } from './changes-scope';

export type GitChangesCommand =
  | { type: 'git/status'; projectPath: string }
  | { type: 'git/diff-summary'; projectPath: string }
  | {
      type: 'git/diff-file';
      projectPath: string;
      path: string;
      scope?: 'worktree' | 'staged' | 'combined';
    }
  | { type: 'git/stage'; input: { projectPath: string; paths: string[] } }
  | { type: 'git/unstage'; input: { projectPath: string; paths: string[] } }
  | {
      type: 'git/commit';
      input: { projectPath: string; message: string; allTracked?: boolean };
    };

export type GitChangesRequest = (command: GitChangesCommand) => Promise<HostResponse>;

export type GitChangesState = {
  snapshot: GitStatusSnapshot | null;
  rows: ChangeRow[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  revision: number;
  reload: () => Promise<void>;
  /** `paths: []` applies to every change, as Host defines it. */
  setStaged: (kind: 'stage' | 'unstage', paths: string[]) => Promise<boolean>;
  commit: (message: string, options: { stageAllFirst: boolean }) => Promise<boolean>;
};

export function useGitChanges(projectPath: string | null, request: GitChangesRequest): GitChangesState {
  const [snapshot, setSnapshot] = useState<GitStatusSnapshot | null>(null);
  const [diff, setDiff] = useState<GitDiffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  // Depend on the fields, not a props object: the parent re-renders on every
  // composer keystroke, and a fresh identity here used to refetch per key.
  const reload = useCallback(async () => {
    if (!projectPath) {
      setSnapshot(null);
      setDiff(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const [statusResponse, diffResponse] = await Promise.all([
      request({ type: 'git/status', projectPath }),
      request({ type: 'git/diff-summary', projectPath }),
    ]);
    setLoading(false);
    if (!statusResponse.success) {
      setError(statusResponse.error);
      return;
    }
    setSnapshot((statusResponse.data as { snapshot: GitStatusSnapshot }).snapshot);
    // Status is the source of truth for the file list; a summary can fail on
    // binary/untracked files without hiding the files themselves.
    setDiff(diffResponse.success ? (diffResponse.data as { summary: GitDiffSummary }).summary : null);
    setRevision((current) => current + 1);
  }, [projectPath, request]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rows = useMemo(
    () => (snapshot ? buildChangeRows(snapshot.changedFiles, diff?.files ?? []) : []),
    [snapshot, diff],
  );

  const mutate = useCallback(
    async (command: GitChangesCommand): Promise<boolean> => {
      setBusy(true);
      setError(null);
      const response = await request(command);
      setBusy(false);
      if (!response.success) {
        setError(response.error);
        return false;
      }
      return true;
    },
    [request],
  );

  const setStaged = useCallback(
    async (kind: 'stage' | 'unstage', paths: string[]): Promise<boolean> => {
      if (!projectPath) return false;
      const ok = await mutate({
        type: kind === 'stage' ? 'git/stage' : 'git/unstage',
        input: { projectPath, paths },
      });
      await reload();
      return ok;
    },
    [projectPath, mutate, reload],
  );

  const commit = useCallback(
    async (message: string, options: { stageAllFirst: boolean }): Promise<boolean> => {
      const trimmed = message.trim();
      if (!projectPath || !trimmed) return false;
      if (options.stageAllFirst) {
        const staged = await mutate({ type: 'git/stage', input: { projectPath, paths: [] } });
        if (!staged) {
          await reload();
          return false;
        }
      }
      const ok = await mutate({ type: 'git/commit', input: { projectPath, message: trimmed } });
      await reload();
      return ok;
    },
    [projectPath, mutate, reload],
  );

  return { snapshot, rows, loading, busy, error, revision, reload, setStaged, commit };
}
