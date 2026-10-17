/**
 * The empty right panel's Environment block: which Host the tools act on, the
 * project folder, and its git branch plus working-tree diff size.
 */
import { useEffect, useRef, useState } from 'react';

export type ChangesStat = { additions: number; deletions: number };

export type HomeGitSummary = {
  /** Branch name, short commit for a detached HEAD, or null outside a repository. */
  branch: string | null;
  changes: ChangesStat | null;
};

export type HomeProjectFolder = { name: string; parentPath: string };

export type RightPanelHomeContext = {
  host: { label: string; remote: boolean };
  project: HomeProjectFolder | null;
  /** Refetch identity for git (the project path); null: nothing to ask git about. */
  gitKey: string | null;
  loadGit?: () => Promise<HomeGitSummary | null>;
};

/** Fetched only while the launcher is visible, so a closed panel never polls git. */
export function useHomeGitSummary(
  context: RightPanelHomeContext | undefined,
  active: boolean,
): HomeGitSummary | null {
  const [summary, setSummary] = useState<HomeGitSummary | null>(null);
  const loadRef = useRef(context?.loadGit);
  loadRef.current = context?.loadGit;
  const gitKey = context?.gitKey ?? null;

  useEffect(() => {
    const load = loadRef.current;
    if (!active || gitKey === null || !load) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    load().then(
      (next) => {
        if (!cancelled) setSummary(next);
      },
      (error: unknown) => {
        console.warn('[piwin] could not load right panel git summary', error);
        if (!cancelled) setSummary(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, gitKey]);

  return summary;
}

const HOME_DIR_PREFIX = /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:\\Users\\[^\\]+)(?=$|[\\/])/;

export function describeProjectFolder(projectPath: string | null): HomeProjectFolder | null {
  const trimmed = projectPath?.replace(/[\\/]+$/, '');
  if (!trimmed) return null;
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const name = trimmed.slice(cut + 1);
  if (!name) return null;
  const parent = cut > 0 ? trimmed.slice(0, cut) : '';
  return { name, parentPath: parent.replace(HOME_DIR_PREFIX, '~') };
}
