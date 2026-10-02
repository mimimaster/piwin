/**
 * External agent (Grok Build) bootstrap hydration and catalog sync (ADR 0082).
 *
 * The Host owns detection, readiness and the agent-side session catalog. This
 * module performs only the Desktop bootstrap requests; pure "what states mean"
 * helpers live in ../agent-backend-state.ts.
 */
import type { Dispatch } from 'react';
import type { ExternalAgentStatus, HostServerMessage } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { ChatUiAction } from '../chat-reducer';
import { isAgentReady } from '../agent-backend-state';

/** Fire the agent's session-catalog sync; failures are logged, never user-facing. */
export function syncAgentCatalog(hostClient: HostClient, agentId: string): void {
  void hostClient.request({ type: 'agents/sessions-sync', agentId }).catch((error: unknown) => {
    console.error('[agent-bootstrap] agents/sessions-sync failed', error);
  });
}

/**
 * Bootstrap the discovered external agents once the Host reports ready.
 * Returns the statuses applied, so the caller can sync catalogs for any agent
 * that is already usable.
 */
export async function bootstrapExternalAgents(
  hostClient: HostClient,
  dispatch: Dispatch<ChatUiAction>,
  options?: { refresh?: boolean },
): Promise<ExternalAgentStatus[]> {
  try {
    const response = await hostClient.request({
      type: 'agents/status',
      ...(options?.refresh ? { refresh: true } : {}),
    });
    if (!response.success) {
      return [];
    }
    const data = response.data as { agents?: ExternalAgentStatus[] } | undefined;
    const agents = data?.agents;
    if (!Array.isArray(agents)) {
      return [];
    }
    dispatch({ type: 'agents/set-all', agents });
    return agents;
  } catch (error) {
    console.error('[agent-bootstrap] agents/status failed', error);
    return [];
  }
}

/** Sync the catalog for every agent that is already ready at bootstrap time. */
export function syncReadyAgentCatalogs(
  hostClient: HostClient,
  agents: readonly ExternalAgentStatus[],
): void {
  for (const agent of agents) {
    if (isAgentReady(agent)) {
      syncAgentCatalog(hostClient, agent.agentId);
    }
  }
}

/** Extension mutations own backend availability, including ordinary market installs. */
export function handleExternalAgentPush(
  hostClient: HostClient,
  dispatch: Dispatch<ChatUiAction>,
  message: HostServerMessage,
): boolean {
  if (message.type === 'marketplace/inventory-updated' &&
      message.changedKinds.some((kind) => kind === 'extension' || kind === 'agent')) {
    void bootstrapExternalAgents(hostClient, dispatch, { refresh: true });
    return true;
  }
  if (message.type === 'agents/status-updated') {
    dispatch({ type: 'agents/status-updated', status: message.status });
    // The first ready status imports sessions created outside piwin as well.
    if (isAgentReady(message.status)) syncAgentCatalog(hostClient, message.status.agentId);
    return true;
  }
  return false;
}
