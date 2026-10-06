/**
 * Composer-side controls for an external agent session (ADR 0082).
 *
 * The agent owns its model / effort / mode catalog, so the Desktop never
 * derives these from the global Pi provider list. Selections are written with
 * `session/backend-set`; the Host is the authority and answers with the
 * resulting `SessionBackendOptions`, which is what keeps `modeConfirmed` honest.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { ExternalAgentStatus, SessionBackendBinding, SessionBackendOptions } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction } from '../chat-reducer';
import { agentDisplayName, backendOptionsFor } from '../agent-backend-state';
import { resolveDraftBackendOptions, type DraftBackendSelections } from '../backend-draft-options';
import type { ComposerDraftAgentOption } from '../composer-dock-types';

export type BackendSessionControls = {
  /** Non-null only for a session bound to a non-Pi backend, or a draft targeting one. */
  options: SessionBackendOptions | null;
  agentLabel: string | null;
  selectModel: (modelId: string) => void;
  selectEffort: (effortId: string) => void;
  selectMode: (modeId: string) => void;
  clearDraftSelections: () => void;
  draftBackendModelId?: string | undefined;
  draftBackendEffortId?: string | undefined;
};

/**
 * Pi is always offered. Other entries come from enabled extension declarations;
 * a Host status can still surface a backend whose declaration is not loaded yet,
 * labelled by its id rather than a hardcoded product name.
 */
export function draftAgentOptionsFrom(
  agents: readonly { agentId: string; state: string }[],
  backends: readonly { agentId: string; name: string; description?: string }[] = [],
): ComposerDraftAgentOption[] {
  const options: ComposerDraftAgentOption[] = [{ agentId: 'pi', label: 'Pi', ready: true }];
  const seen = new Set<string>(['pi']);
  for (const backend of backends) {
    if (seen.has(backend.agentId)) continue;
    seen.add(backend.agentId);
    const status = agents.find((agent) => agent.agentId === backend.agentId);
    options.push({
      agentId: backend.agentId,
      label: backend.name,
      ready: status?.state === 'ready',
      ...(status?.state ? { state: status.state } : {}),
      ...(backend.description ? { description: backend.description } : {}),
    });
  }
  for (const agent of agents) {
    if (seen.has(agent.agentId)) continue;
    if ('reason' in agent && typeof agent.reason === 'string' && agent.reason.toLowerCase().includes('disabled')) {
      continue;
    }
    seen.add(agent.agentId);
    options.push({
      agentId: agent.agentId,
      label: agentDisplayName(agent.agentId),
      ready: agent.state === 'ready',
      state: agent.state,
    });
  }
  return options;
}

export function useBackendSessionControls(args: {
  hostClient: HostClient;
  dispatch: Dispatch<ChatUiAction>;
  sessionId: string | null;
  optionsBySession: Readonly<Record<string, SessionBackendOptions>>;
  draftAgentId?: string | null | undefined;
  externalAgents?: readonly ExternalAgentStatus[] | undefined;
  sessionBackend?: SessionBackendBinding | undefined;
}): BackendSessionControls {
  const { hostClient, dispatch, sessionId, optionsBySession, draftAgentId, externalAgents, sessionBackend } = args;

  const [draftOverridesByAgent, setDraftOverridesByAgent] = useState<
    Record<string, DraftBackendSelections>
  >({});
  const [draftResetEpoch, setDraftResetEpoch] = useState(0);
  const clearDraftSelections = useCallback(() => {
    setDraftOverridesByAgent({});
    setDraftResetEpoch((epoch) => epoch + 1);
  }, []);
  const isDraftExternal = sessionId === null && Boolean(draftAgentId && draftAgentId !== 'pi');
  const draftResolution = useMemo(
    () =>
      isDraftExternal && draftAgentId
        ? resolveDraftBackendOptions(
            draftAgentId,
            externalAgents,
            draftOverridesByAgent[draftAgentId],
          )
        : null,
    [isDraftExternal, draftAgentId, externalAgents, draftOverridesByAgent],
  );
  const options =
    sessionId !== null
      ? (backendOptionsFor(optionsBySession, sessionId) ?? null)
      : (draftResolution?.options ?? null);

  // Latest options per session, including optimistic patches the reducer has
  // not committed yet. Sync from the committed map without letting another
  // session's update wipe an uncommitted patch, and drop sessions that are gone.
  const optionsCacheRef = useRef<Readonly<Record<string, SessionBackendOptions>>>({});
  const committedOptionsRef = useRef(optionsBySession);
  useLayoutEffect(() => {
    const previous = committedOptionsRef.current;
    const cache = optionsCacheRef.current;
    const next: Record<string, SessionBackendOptions> = {};
    for (const [cachedSessionId, committed] of Object.entries(optionsBySession)) {
      const cached = cache[cachedSessionId];
      next[cachedSessionId] = committed === previous[cachedSessionId] && cached !== undefined ? cached : committed;
    }
    optionsCacheRef.current = next;
    committedOptionsRef.current = optionsBySession;
  }, [optionsBySession]);

  useEffect(() => {
    if (!draftResolution || !draftAgentId) return;
    const valid = draftResolution.selections;
    setDraftOverridesByAgent((previous) => {
      const saved = previous[draftAgentId];
      if (
        !saved ||
        (saved.modelId === valid.modelId &&
          saved.effortId === valid.effortId &&
          saved.modeId === valid.modeId)
      ) {
        return previous;
      }
      return { ...previous, [draftAgentId]: valid };
    });
  }, [draftResolution, draftAgentId]);

  // One targeted read on draft entry; the Host owns TTL and concurrent checks.
  useEffect(() => {
    if (!isDraftExternal || !draftAgentId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await hostClient.request({ type: 'agents/status', agentId: draftAgentId });
        if (cancelled || !response.success) return;
        const data = response.data as { agents?: ExternalAgentStatus[] } | undefined;
        const status = Array.isArray(data?.agents)
          ? data.agents.find((agent) => agent.agentId === draftAgentId) : undefined;
        if (status) dispatch({ type: 'agents/status-updated', status });
      } catch (error) {
        if (!cancelled) console.error('[backend-controls] agents/status failed', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostClient, dispatch, isDraftExternal, draftAgentId, draftResetEpoch]);

  // A session restored from a saved layout mounts before the Host answered its
  // snapshot; ask once when the backend catalog is still unknown.
  useEffect(() => {
    if (sessionId === null || options !== null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await hostClient.request({ type: 'session/backend-get', sessionId });
        if (cancelled || !response.success) {
          return;
        }
        const data = response.data as
          | {
              agentId?: string;
              capabilities?: import('@piwin/contracts').SessionBackendCapabilities;
              options?: SessionBackendOptions;
            }
          | undefined;
        // A nonresident session has no live catalog. Reuse only the matching
        // Host-declared agent catalog; saved choices are validated by the same
        // policy as drafts. This supplies choices, not a runtime confirmation.
        const readyAgent = externalAgents?.find((agent) =>
          agent.agentId === sessionBackend?.agentId && agent.state === 'ready',
        );
        const fallback = data?.options === undefined &&
          sessionBackend !== undefined && sessionBackend.agentId !== 'pi' &&
          data?.agentId === sessionBackend.agentId && readyAgent !== undefined
          ? resolveDraftBackendOptions(sessionBackend.agentId, [readyAgent], sessionBackend)
          : null;
        const hydratedOptions = data?.options ??
          (fallback && fallback.options.agentId === sessionBackend?.agentId
            ? { ...fallback.options, modeConfirmed: false } : undefined);
        if (hydratedOptions !== undefined || data?.capabilities !== undefined) {
          dispatch({
            type: 'session/backend-hydrated',
            sessionId,
            ...(data?.capabilities !== undefined ? { capabilities: data.capabilities } : {}),
            ...(hydratedOptions !== undefined ? { options: hydratedOptions } : {}),
          });
        }
      } catch {
        // Best-effort: a Pi session answers without backend options.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostClient, dispatch, sessionId, options, sessionBackend, externalAgents]);

  const publishOptions = useCallback(
    (targetSessionId: string, next: SessionBackendOptions) => {
      optionsCacheRef.current = { ...optionsCacheRef.current, [targetSessionId]: next };
      dispatch({ type: 'session/backend-updated', sessionId: targetSessionId, options: next });
    },
    [dispatch],
  );

  const applyLocal = useCallback(
    (targetSessionId: string, patch: Partial<SessionBackendOptions>) => {
      const current = optionsCacheRef.current[targetSessionId];
      if (current === undefined) return;
      publishOptions(targetSessionId, { ...current, ...patch });
    },
    [publishOptions],
  );

  const send = useCallback(
    (field: 'modelId' | 'effortId' | 'modeId', value: string, optimistic: Partial<SessionBackendOptions>) => {
      if (sessionId === null) {
        return;
      }
      const capturedSessionId = sessionId;
      applyLocal(capturedSessionId, optimistic);
      void (async () => {
        try {
          const response = await hostClient.request({
            type: 'session/backend-set',
            sessionId: capturedSessionId,
            [field]: value,
          });
          if (!response.success) {
            return;
          }
          // Live options replace the session cache exactly. A no-options success
          // only confirms a still-current mode on that session's latest options;
          // it must not replay this request's model, effort, or mode id.
          const data = response.data as { options?: SessionBackendOptions } | undefined;
          if (data?.options !== undefined) {
            publishOptions(capturedSessionId, data.options);
          } else if (optimistic.modeConfirmed === false) {
            const latest = optionsCacheRef.current[capturedSessionId];
            if (latest !== undefined && latest.currentModeId === optimistic.currentModeId) {
              applyLocal(capturedSessionId, { modeConfirmed: true });
            }
          }
        } catch (error) {
          console.error('[backend-controls] session/backend-set failed', error);
        }
      })();
    },
    [applyLocal, hostClient, publishOptions, sessionId],
  );

  const selectModel = useCallback(
    (modelId: string) => {
      if (sessionId === null) {
        if (draftAgentId && draftAgentId !== 'pi') {
          setDraftOverridesByAgent((prev) => ({
            ...prev,
            [draftAgentId]: { ...prev[draftAgentId], modelId },
          }));
        }
        return;
      }
      // A new model may drop the current effort; the Host answer corrects it
      // with the model's real effort list.
      send('modelId', modelId, { currentModelId: modelId });
    },
    [draftAgentId, send, sessionId],
  );

  const selectEffort = useCallback(
    (effortId: string) => {
      if (sessionId === null) {
        if (draftAgentId && draftAgentId !== 'pi') {
          setDraftOverridesByAgent((prev) => ({
            ...prev,
            [draftAgentId]: { ...prev[draftAgentId], effortId },
          }));
        }
        return;
      }
      send('effortId', effortId, { currentEffortId: effortId });
    },
    [draftAgentId, send, sessionId],
  );

  const selectMode = useCallback(
    (modeId: string) => {
      if (sessionId === null) {
        if (draftAgentId && draftAgentId !== 'pi') {
          setDraftOverridesByAgent((prev) => ({
            ...prev,
            [draftAgentId]: { ...prev[draftAgentId], modeId },
          }));
        }
        return;
      }
      // Modes are agent-side: show the request as pending until the agent
      // confirms, so the pill never claims a mode the agent did not accept.
      send('modeId', modeId, { currentModeId: modeId, modeConfirmed: false });
    },
    [draftAgentId, send, sessionId],
  );

  return {
    options,
    agentLabel: options ? agentDisplayName(options.agentId) : null,
    selectModel,
    selectEffort,
    selectMode,
    clearDraftSelections,
    draftBackendModelId: sessionId === null ? options?.currentModelId : undefined,
    draftBackendEffortId: sessionId === null ? options?.currentEffortId : undefined,
  };
}
