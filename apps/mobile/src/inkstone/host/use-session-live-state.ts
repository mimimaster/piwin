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
  /**
   * Ask the Host for the summaries of runs already on screen (history turns
   * that were sealed before this client connected). Read-only: mobile shows
   * the state but never undoes.
   */
  ensureTurnChanges: (runIds: readonly string[]) => void;
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
  const requestedRunsRef = useRef(new Set<string>());
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  const ownerRef = useRef({ client, sessionId, active: false, connected: false,
    connection: 0, prompt: undefined as ExtensionUiPrompt | undefined,
    pending: undefined as object | undefined });
  if (ownerRef.current.client !== client || ownerRef.current.sessionId !== sessionId) {
    ownerRef.current = { client, sessionId, active: false, connected: false,
      connection: 0, prompt: undefined, pending: undefined };
  }
  const owner = ownerRef.current;

  // A summary for an older revision never replaces a newer one.
  const mergeChanges = useCallback((summaries: readonly TurnChangeSummary[]) => {
    if (summaries.length === 0) return;
    setChangesByRunId((current) => {
      const next = new Map(current);
      for (const summary of summaries) {
        for (const runId of summary.runIds) {
          const existing = next.get(runId);
          if (existing?.changeSetId === summary.changeSetId && existing.revision > summary.revision) continue;
          next.set(runId, summary);
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setContext(undefined);
    setChangesByRunId(new Map());
    requestedRunsRef.current.clear();
    outputCacheRef.current.clear();
    setExtensionUi(undefined);
  }, [client, sessionId]);

  useEffect(() => {
    if (client === undefined) return undefined;
    owner.active = true;
    const unsubscribeState = client.subscribeState((state) => {
      if (ownerRef.current !== owner || !owner.active) return;
      const connected = state.kind === 'ready';
      if (owner.connected !== connected) owner.connection += 1;
      owner.connected = connected;
      if (!connected) {
        owner.prompt = undefined;
        owner.pending = undefined;
        setExtensionUi(undefined);
      }
    });
    const unsubscribePush = client.subscribePush((push: HostPush) => {
      if (ownerRef.current !== owner || !owner.active || !owner.connected) return;
      const active = owner.sessionId;
      switch (push.type) {
        case 'extension/ui_request':
          if (push.sessionId === active) {
            if (owner.prompt?.requestId === push.requestId && owner.prompt.sessionId === push.sessionId) return;
            owner.prompt = {
              sessionId: push.sessionId,
              requestId: push.requestId,
              kind: push.kind,
              title: push.title,
              message: push.message,
              options: push.options ?? [],
              placeholder: push.placeholder,
            };
            owner.pending = undefined;
            setExtensionUi(owner.prompt);
          }
          return;
        case 'run/terminal':
          // A finished run can never answer its question; drop the stale card.
          if (push.run.sessionId === active) {
            owner.prompt = undefined;
            owner.pending = undefined;
            setExtensionUi(undefined);
          }
          return;
        case 'session/context-updated':
          if (push.sessionId === active) {
            setContext((current) =>
              current === undefined || push.snapshot.revision >= current.revision ? push.snapshot : current,
            );
          }
          return;
        case 'turn-changes/updated':
          if (push.summary.sessionId === active) mergeChanges([push.summary]);
          return;
        default:
          return;
      }
    });
    return () => {
      owner.active = false;
      owner.prompt = undefined;
      owner.pending = undefined;
      unsubscribePush();
      unsubscribeState();
    };
  }, [client, sessionId, owner, mergeChanges]);

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
      if (client === undefined || prompt === undefined || ownerRef.current !== owner ||
          !owner.active || !owner.connected || owner.prompt !== prompt ||
          prompt.sessionId !== sessionId || owner.pending !== undefined ||
          !client.supportsCommand('extension/ui_resolve')) return false;
      const token = {};
      const connection = owner.connection;
      owner.pending = token;
      const ownsPrompt = () => ownerRef.current === owner && owner.active && owner.connected &&
        owner.connection === connection && owner.prompt === prompt && owner.pending === token;
      try {
        const response = await client.request({
          type: 'extension/ui_resolve',
          requestId: prompt.requestId,
          ...(answer.kind === 'confirm' ? { confirmed: answer.confirmed } : {}),
          ...(answer.kind === 'value' ? { value: answer.value } : {}),
          ...(answer.kind === 'cancel' ? { cancelled: true } : {}),
        });
        if (!ownsPrompt()) return true; // Suppressed stale completion is not a card error.
        if (response.success) {
          owner.prompt = undefined;
          setExtensionUi(undefined);
        }
        return response.success;
      } catch (error: unknown) {
        console.warn('[mobile] extension/ui_resolve failed', error);
        if (!ownsPrompt()) return true;
        throw error;
      } finally {
        if (owner.pending === token) owner.pending = undefined;
      }
    },
    [client, extensionUi, sessionId, owner],
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

  const ensureTurnChanges = useCallback(
    (runIds: readonly string[]) => {
      if (client === undefined || sessionId === undefined) return;
      if (!client.supportsCommand('turn-changes/list-by-runs')) return;
      const missing = runIds.filter((runId) => !requestedRunsRef.current.has(runId));
      if (missing.length === 0) return;
      for (const runId of missing) requestedRunsRef.current.add(runId);
      void client
        .request({ type: 'turn-changes/list-by-runs', sessionId, runIds: missing })
        .then((response) => {
          if (response.success && sessionRef.current === sessionId) {
            mergeChanges((response.data as { summaries?: TurnChangeSummary[] }).summaries ?? []);
          }
        })
        .catch((error: unknown) => {
          for (const runId of missing) requestedRunsRef.current.delete(runId);
          console.warn('[mobile] turn-changes/list-by-runs failed', error);
        });
    },
    [client, mergeChanges, sessionId],
  );

  return { extensionUi: owner.prompt === extensionUi ? extensionUi : undefined,
    resolveExtensionUi, context, changesByRunId, ensureTurnChanges, readToolOutput };
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
