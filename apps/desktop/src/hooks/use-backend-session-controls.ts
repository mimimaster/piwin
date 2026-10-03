/**
 * Composer-side controls for an external agent session (ADR 0082).
 *
 * The agent owns its model / effort / mode catalog, so the Desktop never
 * derives these from the global Pi provider list. Selections are written with
 * `session/backend-set`; the Host is the authority and answers with the
 * resulting `SessionBackendOptions`, which is what keeps `modeConfirmed` honest.
 */
import { useCallback, useEffect, useMemo, useState, type Dispatch } from 'react';
import type { ExternalAgentStatus, SessionBackendOptions } from '@piwin/contracts';
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
}): BackendSessionControls {
  const { hostClient, dispatch, sessionId, optionsBySession, draftAgentId, externalAgents } = args;

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
              capabilities?: import('@piwin/contracts').SessionBackendCapabilities;
              options?: SessionBackendOptions;
            }
          | undefined;
        if (data?.options !== undefined || data?.capabilities !== undefined) {
          dispatch({
            type: 'session/backend-hydrated',
            sessionId,
            ...(data.capabilities !== undefined ? { capabilities: data.capabilities } : {}),
            ...(data.options !== undefined ? { options: data.options } : {}),
          });
        }
      } catch {
        // Best-effort: a Pi session answers without backend options.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostClient, dispatch, sessionId, options]);

  const applyLocal = useCallback(
    (patch: Partial<SessionBackendOptions>) => {
      if (sessionId === null || options === null) {
        return;
      }
      dispatch({
        type: 'session/backend-updated',
        sessionId,
        options: { ...options, ...patch },
      });
    },
    [dispatch, options, sessionId],
  );

  const send = useCallback(
    (field: 'modelId' | 'effortId' | 'modeId', value: string, optimistic: Partial<SessionBackendOptions>) => {
      if (sessionId === null) {
        return;
      }
      applyLocal(optimistic);
      void (async () => {
        try {
          const response = await hostClient.request({
            type: 'session/backend-set',
            sessionId,
            [field]: value,
          });
          if (!response.success) {
            return;
          }
          // The Host answers with the live options when a session process is
          // running. Without a live process the choice is only persisted for
          // the next resume, so there is nothing to confirm yet — settle the
          // pending affordance instead of leaving it spinning forever.
          const data = response.data as { options?: SessionBackendOptions } | undefined;
          if (data?.options !== undefined) {
            dispatch({ type: 'session/backend-updated', sessionId, options: data.options });
          } else {
            applyLocal({ modeConfirmed: true });
          }
        } catch (error) {
          console.error('[backend-controls] session/backend-set failed', error);
        }
      })();
    },
    [applyLocal, dispatch, hostClient, sessionId],
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
