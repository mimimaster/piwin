import { useEffect, useRef } from 'react';
import type { SessionScope } from '@piwin/contracts';
import type { ChatUiState } from '../conversation/chat-reducer.js';
import type { HostClient } from '../host/host-client.js';
import { sessionCacheHostKey } from '../session/session-cache-host.js';
import {
  buildSessionStartupSnapshot,
  writeSessionStartupSnapshot,
} from '../session/session-startup-cache.js';

const WRITE_DELAY_MS = 1_000;

type StartupCacheArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  handleResumeSession: (
    sessionId: string,
    context: {
      scope: SessionScope;
      quiet: boolean;
      refresh: boolean;
    },
  ) => Promise<void>;
};

/** Cached content paints first; only Host resume can settle its authority. */
export function useSessionStartupCache(args: StartupCacheArgs): void {
  const { hostClient, state } = args;
  const hostKey = sessionCacheHostKey(hostClient);
  const latest = useRef(args);
  latest.current = args;
  const pendingSession = useRef(
    state.awaitingTranscript && state.foregroundAdmission === 'unknown'
      ? state.activeSessionId
      : null,
  );

  useEffect(() => {
    const sessionId = pendingSession.current;
    if (sessionId === null) return;
    if (state.activeSessionId !== sessionId || !state.awaitingTranscript) {
      pendingSession.current = null;
      return;
    }
    if (!state.hostReady) return;
    pendingSession.current = null;
    void latest.current
      .handleResumeSession(sessionId, {
        scope: state.activeScope,
        quiet: true,
        refresh: true,
      })
      .catch((error: unknown) => console.warn('Cached session refresh failed', error));
  }, [state.activeScope, state.activeSessionId, state.awaitingTranscript, state.hostReady]);

  useEffect(() => {
    if (hostKey === null || !state.hostReady || state.awaitingTranscript) return undefined;
    const timer = setTimeout(() => {
      const current = latest.current;
      if (
        current.hostClient !== hostClient ||
        !current.state.hostReady ||
        current.state.awaitingTranscript
      )
        return;
      writeSessionStartupSnapshot(hostKey, buildSessionStartupSnapshot(current.state));
    }, WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    hostClient,
    hostKey,
    state.activeSessionId,
    state.hostReady,
    state.awaitingTranscript,
    state.messages,
    state.activeScope,
    state.sessionEntitiesById,
    state.activeSessionMetadata,
  ]);

  useEffect(() => {
    if (hostKey === null) return undefined;
    const flush = (): void => {
      const current = latest.current;
      if (
        current.hostClient !== hostClient ||
        !current.state.hostReady ||
        current.state.awaitingTranscript
      )
        return;
      writeSessionStartupSnapshot(hostKey, buildSessionStartupSnapshot(current.state));
    };
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [hostClient, hostKey]);
}
