/**
 * Multi-session state for the Tauri interactive terminal dock.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { tauriPtyClose, tauriPtyCloseAll } from './tauri-pty';
import type { PtyStatus } from './xterm-surface';

export type TerminalSession = {
  id: string;
  name: string;
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
  addSession: () => TerminalSession | null;
  closeSession: (id: string) => void;
  restartSession: (id: string) => void;
  onSessionStatus: (id: string, status: PtyStatus, ptyId: string | null, message?: string) => void;
};

export function useTerminalSessions(
  projectPath: string | null,
  projectTrusted: boolean,
  enabled: boolean,
): TerminalSessionsApi {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const counterRef = useRef(1);
  const previousKeyRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    setSessions([]);
    setActiveSessionId(null);
    counterRef.current = 1;
  }, []);

  const createSession = useCallback(
    (name?: string): TerminalSession => {
      const index = counterRef.current;
      counterRef.current += 1;
      return {
        id: `terminal-${index}`,
        name: name ?? `zsh ${index}`,
        projectPath: projectPath ?? '',
        status: 'idle',
        error: null,
        generation: 0,
        ptyId: null,
      };
    },
    [projectPath],
  );

  const addSession = useCallback((): TerminalSession | null => {
    if (!projectPath || !projectTrusted || !enabled) return null;
    const session = createSession();
    setSessions((current) => [...current, session]);
    setActiveSessionId(session.id);
    return session;
  }, [createSession, projectPath, projectTrusted, enabled]);

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

  // Initialize or reset when project/trust/mode changes.
  const sessionKey = enabled && projectPath && projectTrusted ? `${projectPath}:${projectTrusted}` : null;
  useEffect(() => {
    if (sessionKey === null) {
      if (sessions.length > 0) {
        void tauriPtyCloseAll().catch(() => {
          /* ignore if not in Tauri */
        });
      }
      reset();
      previousKeyRef.current = null;
      return;
    }
    if (previousKeyRef.current === sessionKey) return;
    previousKeyRef.current = sessionKey;
    if (sessions.length > 0) {
      void tauriPtyCloseAll().catch(() => {
        /* ignore if not in Tauri */
      });
    }
    reset();
    counterRef.current = 1;
    const first = createSession();
    setSessions([first]);
    setActiveSessionId(first.id);
  }, [sessionKey, createSession, reset]);

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
