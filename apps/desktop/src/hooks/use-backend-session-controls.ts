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
import type { ComposerDraftAgentOption } from '../composer-dock-types';

export type BackendSessionControls = {
  /** Non-null only for a session bound to a non-Pi backend, or a draft targeting one. */
  options: SessionBackendOptions | null;
  agentLabel: string | null;
  selectModel: (modelId: string) => void;
  selectEffort: (effortId: string) => void;
  selectMode: (modeId: string) => void;
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

export function resolveDraftBackendOptions(
  agentId: string | null | undefined,
  optionsBySession: Readonly<Record<string, SessionBackendOptions>>,
  externalAgents?: readonly ExternalAgentStatus[],
): SessionBackendOptions | null {
  if (!agentId || agentId === 'pi') {
    return null;
  }
  for (const sessionOptions of Object.values(optionsBySession)) {
    if (sessionOptions.agentId === agentId && sessionOptions.models.length > 0) {
      return sessionOptions;
    }
  }
  const agentStatus = externalAgents?.find((agent) => agent.agentId === agentId);
  if (
    agentStatus &&
    'options' in agentStatus &&
    agentStatus.options &&
    agentStatus.options.models.length > 0
  ) {
    return agentStatus.options;
  }
  return null;
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
    Record<string, { modelId?: string; effortId?: string; modeId?: string }>
  >({});

  const isDraftExternal = sessionId === null && Boolean(draftAgentId && draftAgentId !== 'pi');
  const baseDraftOptions = useMemo(
    () => (isDraftExternal ? resolveDraftBackendOptions(draftAgentId, optionsBySession, externalAgents) : null),
    [isDraftExternal, draftAgentId, optionsBySession, externalAgents],
  );

  const options = useMemo(() => {
    if (sessionId !== null) {
      return backendOptionsFor(optionsBySession, sessionId) ?? null;
    }
    if (!baseDraftOptions || !draftAgentId) {
      return null;
    }
    const override = draftOverridesByAgent[draftAgentId];
    const currentModelId =
      override?.modelId ?? baseDraftOptions.currentModelId ?? baseDraftOptions.models[0]?.id;
    const activeModel = baseDraftOptions.models.find((model) => model.id === currentModelId);
    const efforts = activeModel?.efforts ?? [];
    const currentEffortId =
      override?.effortId && efforts.includes(override.effortId)
        ? override.effortId
        : baseDraftOptions.currentEffortId && efforts.includes(baseDraftOptions.currentEffortId)
          ? baseDraftOptions.currentEffortId
          : efforts[0];
    const currentModeId = override?.modeId ?? baseDraftOptions.currentModeId;
    return {
      ...baseDraftOptions,
      ...(currentModelId !== undefined ? { currentModelId } : {}),
      ...(currentEffortId !== undefined ? { currentEffortId } : {}),
      ...(currentModeId !== undefined ? { currentModeId } : {}),
    };
  }, [sessionId, optionsBySession, baseDraftOptions, draftAgentId, draftOverridesByAgent]);

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
    draftBackendModelId: sessionId === null ? options?.currentModelId : undefined,
    draftBackendEffortId: sessionId === null ? options?.currentEffortId : undefined,
  };
}
