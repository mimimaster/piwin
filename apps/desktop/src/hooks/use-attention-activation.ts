import { useCallback, useEffect, useRef, useState } from 'react';
import { showUiNotification } from '@piwin/ui-kit';
import { resolveActivationSessionId } from '../attention-session-lookup';
import type { ChatUiState } from '../chat-reducer';
import type { AttentionActivation } from '../desktop-attention-os';
import type { DesktopLocale } from '../desktop-locale';

/**
 * How long a notification click may wait, after Host is ready and the session
 * lists stop changing, before it is reported as unavailable.
 */
export const ACTIVATION_RESOLVE_GRACE_MS = 8_000;

/**
 * Open the session a system notification points at.
 *
 * Closing the window quits Piwin, so a notification click usually launches
 * it: the activation arrives before Host has hydrated any session list, and
 * an immediate lookup reported 「该会话已不可用」 for a session that exists.
 * Hold the activation until a list or entity update contains it.
 *
 * The same click reaches the page twice (the live event and the stored
 * pending copy read at mount); `attentionKey` makes the second a no-op.
 */
export function useAttentionActivation(args: {
  state: ChatUiState;
  locale: DesktopLocale;
  openSession: (sessionId: string) => void | Promise<void>;
}): (activation: AttentionActivation) => void {
  const { state } = args;
  const [pending, setPending] = useState<AttentionActivation | null>(null);
  const handledKeyRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const openRef = useRef(args.openSession);
  openRef.current = args.openSession;
  const localeRef = useRef(args.locale);
  localeRef.current = args.locale;

  const handleActivation = useCallback((activation: AttentionActivation): void => {
    if (handledKeyRef.current === activation.attentionKey) return;
    handledKeyRef.current = activation.attentionKey;
    const target = resolveActivationSessionId(stateRef.current, activation.sessionId);
    if (target === null) {
      setPending(activation);
      return;
    }
    setPending(null);
    void openRef.current(target);
  }, []);

  // Re-resolve only when a session list, the entity map, or Host readiness
  // changes; streaming state churn must not keep restarting the grace timer.
  useEffect(() => {
    if (pending === null) return;
    const target = resolveActivationSessionId(stateRef.current, pending.sessionId);
    if (target !== null) {
      setPending(null);
      void openRef.current(target);
      return;
    }
    if (!stateRef.current.hostReady) return;
    const timer = window.setTimeout(() => {
      setPending(null);
      showUiNotification({
        tone: 'info',
        message:
          localeRef.current === 'zh-CN'
            ? '该会话已不可用'
            : 'This session is no longer available',
      });
    }, ACTIVATION_RESOLVE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [
    pending,
    state.hostReady,
    state.sessions,
    state.generalSessions,
    state.projectSessionsByPath,
    state.sessionEntitiesById,
  ]);

  return handleActivation;
}
