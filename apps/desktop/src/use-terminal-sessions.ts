/**
 * Multi-session state for the Tauri interactive terminal dock.
 * Now supports general-scope terminals (no project required).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { tauriPtyClose, tauriPtyCloseAll } from './tauri-pty';
import type { PtyStatus } from './xterm-surface';

/** Concurrent PTY/xterm sessions, including the one created on enable. */
export const MAX_TERMINAL_SESSIONS = 4;

export type TerminalSession = {
  id: string;
  name: string;
  /** Actual working directory for this terminal session. */
  cwd: string;
  /** Project root for authorization (empty = general-scope terminal). */
  projectPath: string;
  status: PtyStatus;
  error: string | null;
  generation: number;
  ptyId: string | null;
};

export type TerminalSessionsApi = {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  addSession: (cwd?: string) => TerminalSession | null;
  closeSession: (id: string) => void;
  restartSession: (id: string) => void;
  onSessionStatus: (id: string, status: PtyStatus, ptyId: string | null, message?: string) => void;
};

export function useTerminalSessions(
  projectPath: string | null,
  _projectTrusted: boolean,
  enabled: boolean,
  defaultCwd: string,
): TerminalSessionsApi {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const sessionsRef = useRef<TerminalSession[]>([]);
  sessionsRef.current = sessions;
  const counterRef = useRef(1);
  const enabledRef = useRef(enabled);

  // Keep enabledRef in sync for the cleanup effect.
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const reset = useCallback(() => {
    setSessions([]);
    setActiveSessionId(null);
    counterRef.current = 1;
  }, []);

  const createSession = useCallback(
    (cwd?: string, name?: string): TerminalSession => {
      const index = counterRef.current;
      counterRef.current += 1;
      const sessionCwd = cwd?.trim() || defaultCwd;
      return {
        id: `terminal-${index}`,
        name: name ?? `zsh ${index}`,
        cwd: sessionCwd,
        projectPath: projectPath ?? '',
        status: 'idle',
        error: null,
        generation: 0,
        ptyId: null,
      };
    },
    [defaultCwd, projectPath],
  );

  const addSession = useCallback(
    (cwd?: string): TerminalSession | null => {
      if (!enabled) return null;
      if (sessionsRef.current.length >= MAX_TERMINAL_SESSIONS) {
        return null;
      }
      // General-scope: allow terminal even without project or trust.
      const session = createSession(cwd);
      setSessions((current) => {
        if (current.length >= MAX_TERMINAL_SESSIONS) {
          return current;
        }
        return [...current, session];
      });
      setActiveSessionId(session.id);
      return session;
    },
    [createSession, enabled],
  );

  const closeSession = useCallback(
    (id: string) => {
      setSessions((current) => {
        const session = current.find((s) => s.id === id);
        if (session?.ptyId) {
          void tauriPtyClose(session.ptyId).catch(() => {
            /* ignore if already closed */
          });
        }
        const next = current.filter((s) => s.id !== id);
        if (activeSessionId === id) {
          setActiveSessionId(next[next.length - 1]?.id ?? null);
        }
        return next;
      });
    },
    [activeSessionId],
  );

  const restartSession = useCallback((id: string) => {
    setSessions((current) =>
      current.map((s) => {
        if (s.id !== id) return s;
        if (s.ptyId) {
          void tauriPtyClose(s.ptyId).catch(() => {
            /* ignore if already closed */
          });
        }
        return { ...s, ptyId: null, status: 'starting', error: null, generation: s.generation + 1 };
      }),
    );
  }, []);

  const onSessionStatus = useCallback(
    (id: string, status: PtyStatus, ptyId: string | null, message?: string) => {
      setSessions((current) =>
        current.map((s) => {
          if (s.id !== id) return s;
          if (status === 'open') {
            return { ...s, status: 'open', ptyId, error: null };
          }
          if (status === 'error') {
            return { ...s, status: 'error', error: message ?? 'PTY error' };
          }
          if (status === 'exited') {
            return { ...s, status: 'exited', ptyId: null };
          }
          return { ...s, status };
        }),
      );
    },
    [],
  );

  // Initialize with a default session when enabled.
  useEffect(() => {
    if (!enabled) {
      if (sessions.length > 0) {
        void tauriPtyCloseAll().catch(() => {
          /* ignore if not in Tauri */
        });
      }
      reset();
      return;
    }

    // If sessions already exist, don't re-initialize.
    if (sessions.length > 0) return;

    const first = createSession();
    setSessions([first]);
    setActiveSessionId(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      void tauriPtyCloseAll().catch(() => {
        /* ignore if not in Tauri */
      });
    };
  }, []);

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    addSession,
    closeSession,
    restartSession,
    onSessionStatus,
  };
}
