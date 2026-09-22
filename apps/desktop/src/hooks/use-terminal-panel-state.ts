/**
 * Right-panel terminal panel state (extracted from App.tsx; ADR 0052 split).
 *
 * Owns the terminal's pty output buffer, the working directory, and the
 * recent-directories list. Output never pulses chrome and never opens the panel.
 */
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { PtyOutputLine } from '../terminal-dock';
import { saveDesktopPreferences, type DesktopPreferences } from '../ui-preferences';
import {
  isDesktopTerminalFilesystemPath,
  resolveInteractiveTerminalCwd,
} from '../interactive-terminal-binding';

export type UseTerminalPanelStateInput = {
  projectPath: string | null | undefined;
  /** App-owned preferences; the handler persists cwd changes through it. */
  preferences: DesktopPreferences;
  setPreferences: Dispatch<SetStateAction<DesktopPreferences>>;
};

export type UseTerminalPanelStateResult = {
  ptyOutput: PtyOutputLine[];
  setPtyOutput: (value: SetStateAction<PtyOutputLine[]>) => void;
  terminalCwd: string;
  terminalRecentDirs: string[];
  handleTerminalCwdChange: (cwd: string) => void;
};

export function useTerminalPanelState(
  input: UseTerminalPanelStateInput,
): UseTerminalPanelStateResult {
  const { projectPath, preferences, setPreferences } = input;

  // Terminal working directory state.
  // Initialized from saved preference, then falls back to project path or home.
  const [terminalCwd, setTerminalCwd] = useState<string>(() => {
    return resolveInteractiveTerminalCwd({
      preferredCwd: preferences.terminalLastCwd || '',
      projectPath,
    });
  });
  const [terminalRecentDirs, setTerminalRecentDirs] = useState<string[]>(() => {
    return preferences.terminalRecentDirs || [];
  });
  const [ptyOutput, setPtyOutputBase] = useState<PtyOutputLine[]>([]);

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
    const nextProjectCwd =
      typeof projectPath === 'string' && isDesktopTerminalFilesystemPath(projectPath)
        ? projectPath.trim()
        : '';
    if (nextProjectCwd && !isDesktopTerminalFilesystemPath(preferences.terminalLastCwd)) {
      setTerminalCwd(nextProjectCwd);
    }
  }, [projectPath, preferences.terminalLastCwd]);

  const setPtyOutput = useCallback(
    (value: SetStateAction<PtyOutputLine[]>): void => {
      setPtyOutputBase(value);
    },
    [],
  );

  const handleTerminalCwdChange = useCallback(
    (cwd: string) => {
      const resolved = resolveInteractiveTerminalCwd({
        preferredCwd: cwd,
        projectPath,
      });
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
    terminalCwd,
    terminalRecentDirs,
    handleTerminalCwdChange,
  };
}
