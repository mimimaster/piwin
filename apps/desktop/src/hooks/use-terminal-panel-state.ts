/**
 * Right-panel terminal panel state (extracted from App.tsx; ADR 0052 split).
 *
 * Owns the terminal's pty output buffer, the "quiet workbench" attention
 * marker, the working directory, and the recent-directories list. The
 * attention marker is driven by a `watchingTerminalRef` supplied by the shell
 * layout: output only pulses chrome when the panel isn't visible — it never
 * auto-opens the panel.
 */
import { useCallback, useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { PtyOutputLine } from '../terminal-dock';
import { saveDesktopPreferences, type DesktopPreferences } from '../ui-preferences';

export type UseTerminalPanelStateInput = {
  projectPath: string | null | undefined;
  /** Ref updated by the shell layout when the terminal panel is visible. */
  watchingTerminalRef: RefObject<boolean>;
  /** App-owned preferences; the handler persists cwd changes through it. */
  preferences: DesktopPreferences;
  setPreferences: Dispatch<SetStateAction<DesktopPreferences>>;
};

export type UseTerminalPanelStateResult = {
  ptyOutput: PtyOutputLine[];
  setPtyOutput: (value: SetStateAction<PtyOutputLine[]>) => void;
  terminalAttention: boolean;
  setTerminalAttention: (value: boolean) => void;
  terminalCwd: string;
  terminalRecentDirs: string[];
  handleTerminalCwdChange: (cwd: string) => void;
  markTerminalAttentionIfHidden: () => void;
};

export function useTerminalPanelState(
  input: UseTerminalPanelStateInput,
): UseTerminalPanelStateResult {
  const { projectPath, watchingTerminalRef, preferences, setPreferences } = input;

  // Terminal working directory state.
  // Initialized from saved preference, then falls back to project path or home.
  const [terminalCwd, setTerminalCwd] = useState<string>(() => {
    return preferences.terminalLastCwd || projectPath || '';
  });
  const [terminalRecentDirs, setTerminalRecentDirs] = useState<string[]>(() => {
    return preferences.terminalRecentDirs || [];
  });
  const [ptyOutput, setPtyOutputBase] = useState<PtyOutputLine[]>([]);
  /** Quiet workbench: terminal produced output while directory home / panel collapsed. */
  const [terminalAttention, setTerminalAttention] = useState(false);

  // Initialize terminal CWD from home directory when no project/preference is set.
  useEffect(() => {
    if (terminalCwd) return;
    let cancelled = false;
    void (async () => {
      try {
        const { homeDir } = await import('@tauri-apps/api/path');
        const home = await homeDir();
        if (!cancelled && home) {
          setTerminalCwd(home);
        }
      } catch {
        // Tauri API not available (browser mock) — use '/' as fallback.
        if (!cancelled) {
          setTerminalCwd('/');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [terminalCwd]);

  // Sync terminal CWD with the project path when a project is opened.
  useEffect(() => {
    if (projectPath && !preferences.terminalLastCwd) {
      setTerminalCwd(projectPath);
    }
  }, [projectPath, preferences.terminalLastCwd]);

  const markTerminalAttentionIfHidden = useCallback((): void => {
    // Hard rule: never auto-open the work panel; only pulse chrome.
    if (!watchingTerminalRef.current) {
      setTerminalAttention(true);
    }
  }, [watchingTerminalRef]);

  const setPtyOutput = useCallback(
    (value: SetStateAction<PtyOutputLine[]>): void => {
      setPtyOutputBase((current) => {
        const next = typeof value === 'function' ? value(current) : value;
        // Only new lines (not clear/replace-empty) raise directory attention.
        if (next.length > current.length) {
          queueMicrotask(() => {
            markTerminalAttentionIfHidden();
          });
        }
        return next;
      });
    },
    [markTerminalAttentionIfHidden],
  );

  const handleTerminalCwdChange = useCallback(
    (cwd: string) => {
      const resolved = cwd || projectPath || '';
      setTerminalCwd(resolved);

      // Update recent directories.
      setTerminalRecentDirs((prev) => {
        const filtered = prev.filter((d) => d !== resolved);
        return [resolved, ...filtered].slice(0, 5);
      });

      // Persist to preferences immediately.
      setPreferences((prev) => {
        const filtered = (prev.terminalRecentDirs ?? []).filter((d) => d !== resolved);
        const next: DesktopPreferences = {
          ...prev,
          terminalLastCwd: resolved,
          terminalRecentDirs: [resolved, ...filtered].slice(0, 5),
        };
        saveDesktopPreferences(next);
        return next;
      });
    },
    [projectPath],
  );

  return {
    ptyOutput,
    setPtyOutput,
    terminalAttention,
    setTerminalAttention,
    terminalCwd,
    terminalRecentDirs,
    handleTerminalCwdChange,
    markTerminalAttentionIfHidden,
  };
}
