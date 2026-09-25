import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExtensionUiKind,
  HostPush,
  SessionContextSnapshot,
  SessionToolOutputData,
  TurnChangeSummary,
} from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';

/**
 * Per-session Host state the transcript renders live: extension UI questions
 * (questionnaire), context occupancy, and turn change summaries. Everything is
 * Host-pushed; this hook only keeps the latest value per session and exposes
 * the matching Host commands. It deliberately lives outside `useMobileHost`
 * so the connection hook does not keep absorbing every push domain.
 */
export interface ExtensionUiPrompt {
  sessionId: string;
  requestId: string;
  kind: ExtensionUiKind;
  title: string;
  message: string | undefined;
  options: string[];
  placeholder: string | undefined;
}

export type ExtensionUiAnswer =
  | { kind: 'confirm'; confirmed: boolean }
  | { kind: 'value'; value: string }
  | { kind: 'cancel' };

export interface SessionLiveState {
  extensionUi: ExtensionUiPrompt | undefined;
  resolveExtensionUi: (answer: ExtensionUiAnswer) => Promise<boolean>;
  context: SessionContextSnapshot | undefined;
  /** Latest change summary per run id, for the turn footer strip. */
  changesByRunId: ReadonlyMap<string, TurnChangeSummary>;
  readToolOutput: (messageId: string, toolCallId: string) => Promise<SessionToolOutputData>;
}

const TOOL_OUTPUT_MAX_BYTES = 64 * 1024;

export function useSessionLiveState(
  client: HostClient | undefined,
  sessionId: string | undefined,
): SessionLiveState {
  const [extensionUi, setExtensionUi] = useState<ExtensionUiPrompt | undefined>();
  const [context, setContext] = useState<SessionContextSnapshot | undefined>();
  const [changesByRunId, setChangesByRunId] = useState<ReadonlyMap<string, TurnChangeSummary>>(
    () => new Map(),
  );
  const outputCacheRef = useRef(new Map<string, Promise<SessionToolOutputData>>());
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  useEffect(() => {
    setContext(undefined);
    setChangesByRunId(new Map());
    outputCacheRef.current.clear();
    setExtensionUi((current) => (current?.sessionId === sessionId ? current : undefined));
  }, [sessionId]);

  useEffect(() => {
    if (client === undefined) {
      return undefined;
    }
    return client.subscribePush((push: HostPush) => {
      const active = sessionRef.current;
      switch (push.type) {
        case 'extension/ui_request':
          if (push.sessionId === active) {
            setExtensionUi({
              sessionId: push.sessionId,
              requestId: push.requestId,
              kind: push.kind,
              title: push.title,
              message: push.message,
              options: push.options ?? [],
              placeholder: push.placeholder,
            });
          }
          return;
        case 'run/terminal':
          // A finished run can never answer its question; drop the stale card.
          setExtensionUi((current) => (current?.sessionId === push.run.sessionId ? undefined : current));
          return;
        case 'session/context-updated':
          if (push.sessionId === active) {
            setContext((current) =>
              current === undefined || push.snapshot.revision >= current.revision ? push.snapshot : current,
            );
          }
          return;
        case 'turn-changes/updated':
          if (push.summary.sessionId === active) {
            setChangesByRunId((current) => {
              const next = new Map(current);
              for (const runId of push.summary.runIds) {
                next.set(runId, push.summary);
              }
              return next;
            });
          }
          return;
        default:
          return;
      }
    });
  }, [client]);

  useEffect(() => {
    if (client === undefined || sessionId === undefined || !client.supportsCommand('session/context-get')) {
      return;
    }
    let cancelled = false;
    void client
      .request({ type: 'session/context-get', sessionId })
      .then((response) => {
        if (!cancelled && response.success && isContextSnapshot(response.data, sessionId)) {
          setContext(response.data);
        }
      })
      .catch((error: unknown) => {
        console.warn('[mobile] session/context-get failed', error);
      });
    return () => {
      cancelled = true;
    };
  }, [client, sessionId]);

  const resolveExtensionUi = useCallback(
    async (answer: ExtensionUiAnswer): Promise<boolean> => {
      const prompt = extensionUi;
      if (client === undefined || prompt === undefined) {
        return false;
      }
      const response = await client.request({
        type: 'extension/ui_resolve',
        requestId: prompt.requestId,
        ...(answer.kind === 'confirm' ? { confirmed: answer.confirmed } : {}),
        ...(answer.kind === 'value' ? { value: answer.value } : {}),
        ...(answer.kind === 'cancel' ? { cancelled: true } : {}),
      });
      if (response.success) {
        setExtensionUi((current) => (current?.requestId === prompt.requestId ? undefined : current));
      }
      return response.success;
    },
    [client, extensionUi],
  );

  const readToolOutput = useCallback(
    (messageId: string, toolCallId: string): Promise<SessionToolOutputData> => {
      if (client === undefined || sessionId === undefined) {
        return Promise.resolve({ status: 'unavailable', reason: 'snapshot-unavailable' });
      }
      const key = `${messageId}:${toolCallId}`;
      const cached = outputCacheRef.current.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const pending = client
        .request({
          type: 'session/tool-output',
          sessionId,
          messageId,
          toolCallId,
          maxBytes: TOOL_OUTPUT_MAX_BYTES,
        })
        .then((response): SessionToolOutputData => {
          if (response.success && isToolOutputData(response.data)) {
            return response.data;
          }
          outputCacheRef.current.delete(key);
          return { status: 'unavailable', reason: 'snapshot-unavailable' };
        });
      outputCacheRef.current.set(key, pending);
      return pending;
    },
    [client, sessionId],
  );

  return { extensionUi, resolveExtensionUi, context, changesByRunId, readToolOutput };
}

/** Percent of the model window the Host measured; undefined when unknown. */
export function contextPercent(snapshot: SessionContextSnapshot | undefined): number | undefined {
  const occupancy = snapshot?.occupancy;
  if (occupancy?.kind !== 'known' || occupancy.tokensLimit === undefined) {
    return undefined;
  }
  return Math.min(100, Math.max(0, Math.round((occupancy.tokensUsed / occupancy.tokensLimit) * 100)));
}

function isContextSnapshot(value: unknown, sessionId: string): value is SessionContextSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    snapshot.sessionId === sessionId &&
    typeof snapshot.revision === 'number' &&
    typeof snapshot.occupancy === 'object'
  );
}

function isToolOutputData(value: unknown): value is SessionToolOutputData {
  if (typeof value !== 'object' || value === null) return false;
  const status = (value as { status?: unknown }).status;
  return status === 'ready' || status === 'unavailable';
}
