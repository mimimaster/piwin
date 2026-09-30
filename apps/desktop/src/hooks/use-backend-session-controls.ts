/**
 * Composer-side controls for an external agent session (ADR 0082).
 *
 * The agent owns its model / effort / mode catalog, so the Desktop never
 * derives these from the global Pi provider list. Selections are written with
 * `session/backend-set`; the Host is the authority and answers with the
 * resulting `SessionBackendOptions`, which is what keeps `modeConfirmed` honest.
 */
import { useCallback, useEffect, useMemo, type Dispatch } from 'react';
import type { SessionBackendOptions } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction } from '../chat-reducer';
import { agentDisplayName, backendOptionsFor } from '../agent-backend-state';
import type { ComposerDraftAgentOption } from '../composer-dock-types';

export type BackendSessionControls = {
  /** Non-null only for a session bound to a non-Pi backend. */
  options: SessionBackendOptions | null;
  agentLabel: string | null;
  selectModel: (modelId: string) => void;
  selectEffort: (effortId: string) => void;
  selectMode: (modeId: string) => void;
};

/** Pi is always offered; external agents only once the Host knows about them. */
export function draftAgentOptionsFrom(
  agents: readonly { agentId: string; state: string }[],
): ComposerDraftAgentOption[] {
  const options: ComposerDraftAgentOption[] = [{ agentId: 'pi', label: 'Pi', ready: true }];
  for (const agent of agents) {
    if (agent.agentId === 'pi') {
      continue;
    }
    options.push({
      agentId: agent.agentId as 'grok',
      label: agentDisplayName(agent.agentId),
      ready: agent.state === 'ready',
    });
  }
  return options;
}

export function useBackendSessionControls(args: {
  hostClient: HostClient;
  dispatch: Dispatch<ChatUiAction>;
  sessionId: string | null;
  optionsBySession: Readonly<Record<string, SessionBackendOptions>>;
}): BackendSessionControls {
  const { hostClient, dispatch, sessionId, optionsBySession } = args;
  const options = useMemo(
    () => backendOptionsFor(optionsBySession, sessionId) ?? null,
    [optionsBySession, sessionId],
  );

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
      // A new model may drop the current effort; the Host answer corrects it
      // with the model's real effort list.
      send('modelId', modelId, { currentModelId: modelId });
    },
    [send],
  );

  const selectEffort = useCallback(
    (effortId: string) => {
      send('effortId', effortId, { currentEffortId: effortId });
    },
    [send],
  );

  const selectMode = useCallback(
    (modeId: string) => {
      // Modes are agent-side: show the request as pending until the agent
      // confirms, so the pill never claims a mode the agent did not accept.
      send('modeId', modeId, { currentModeId: modeId, modeConfirmed: false });
    },
    [send],
  );

  return {
    options,
    agentLabel: options ? agentDisplayName(options.agentId) : null,
    selectModel,
    selectEffort,
    selectMode,
  };
}
