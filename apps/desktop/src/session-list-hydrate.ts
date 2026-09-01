import type { Dispatch } from 'react';
import type {
  SessionListData,
  SessionListOrder,
  SessionScope,
  SessionSummary,
} from '@piwin/contracts';
import type { HostClient } from './host-client';
import type { ChatUiAction } from './chat-reducer';
import { desktopSessionListMaxItems } from './session-list-policy';
import { sessionScopeKey } from './session-scope-key';
import {
  isOpaqueRemoteProjectId,
  isRemoteDesktopTransport,
  mapListedSessionItems,
  sessionListCommandForTransport,
} from './remote-session-hydrate';
import { isWorkbenchHostTeardownError } from './workbench-host-teardown.js';
import { logSessionChain, sessionChainErrorCode } from './session-chain-log.js';

export type HydrateSessionsFromHostInput = {
  hostClient: HostClient;
  dispatch: Dispatch<ChatUiAction>;
  showArchivedSessions: boolean;
  sessionListOrder: SessionListOrder;
  activeScope: SessionScope;
  projectPathOrScope?: string | { kind: 'general' } | { kind: 'project'; projectPath: string };
  options?: {
    includeArchived?: boolean;
    order?: SessionListOrder;
  };
  requestGeneration: number;
  mutationEpoch: number;
  isCurrentGeneration: (generation: number) => boolean;
};

/**
 * Fetch one scope's session page and apply it only if this request is still
 * the latest for that scope. Unnamed rows stay in the payload so the entity
 * store can keep identity until a title arrives.
 */
export async function hydrateSessionsFromHost(
  input: HydrateSessionsFromHostInput,
): Promise<SessionSummary[]> {
  const includeArchived = input.options?.includeArchived ?? input.showArchivedSessions;
  const scope: SessionScope =
    typeof input.projectPathOrScope === 'object' && input.projectPathOrScope !== null
      ? input.projectPathOrScope
      : typeof input.projectPathOrScope === 'string' && input.projectPathOrScope.trim().length > 0
        ? { kind: 'project', projectPath: input.projectPathOrScope }
        : input.activeScope;
  const transport = input.hostClient.getTransport();
  if (
    isRemoteDesktopTransport(transport) &&
    scope.kind === 'project' &&
    !isOpaqueRemoteProjectId(scope.projectPath)
  ) {
    return [];
  }
  const startedAt = Date.now();
  const listed = await input.hostClient.request(
    sessionListCommandForTransport({
      transport,
      scope,
      includeArchived,
      order: input.options?.order ?? input.sessionListOrder,
      maxItems: desktopSessionListMaxItems(transport),
    }),
  );
  if (!listed.success) {
    if (input.isCurrentGeneration(input.requestGeneration) && !isWorkbenchHostTeardownError(listed.error)) {
      logSessionChain({
        event: 'session/list-failed',
        scopeKey: sessionScopeKey(scope),
        queryGeneration: input.requestGeneration,
        mutationEpoch: input.mutationEpoch,
        elapsedMs: Date.now() - startedAt,
        errorCode: sessionChainErrorCode(listed.error),
      });
      input.dispatch({ type: 'session/hydrate-error', scope, error: listed.error });
      input.dispatch({ type: 'error', message: `Could not load sessions: ${listed.error}` });
    }
    return [];
  }
  const mapped = mapListedSessionItems(listed.data);
  if (input.isCurrentGeneration(input.requestGeneration)) {
    logSessionChain({
      event: 'session/list-ready',
      scopeKey: sessionScopeKey(scope),
      queryGeneration: input.requestGeneration,
      mutationEpoch: input.mutationEpoch,
      elapsedMs: Date.now() - startedAt,
    });
    input.dispatch({
      type: 'session/hydrate-scope',
      scope,
      sessions: mapped.sessions,
      totalCount: mapped.totalCount,
      truncated: mapped.truncated,
      mutationEpoch: input.mutationEpoch,
    });
  }
  const data = listed.data as SessionListData;
  if (Array.isArray(data.sessions) && typeof data.sessions[0]?.id === 'string') {
    return data.sessions;
  }
  return mapped.sessions.map((item) => ({
    id: item.id,
    name: item.name,
    scope: item.scope ?? scope,
    workingDirectory: item.scope?.kind === 'project' ? item.scope.projectPath : '',
    projectPath: item.scope?.kind === 'project' ? item.scope.projectPath : '',
    updatedAt: item.updatedAt ?? '',
    messageCount: item.messageCount ?? 0,
  }));
}

export function nextScopeRequestGeneration(
  generations: Map<string, number>,
  scope: SessionScope,
): { scopeKey: string; requestGeneration: number } {
  const scopeKey = sessionScopeKey(scope);
  const requestGeneration = (generations.get(scopeKey) ?? 0) + 1;
  generations.set(scopeKey, requestGeneration);
  return { scopeKey, requestGeneration };
}

export function resolveHydrateScope(
  projectPathOrScope: string | { kind: 'general' } | { kind: 'project'; projectPath: string } | undefined,
  activeScope: SessionScope,
): SessionScope {
  if (typeof projectPathOrScope === 'object' && projectPathOrScope !== null) {
    return projectPathOrScope;
  }
  if (typeof projectPathOrScope === 'string' && projectPathOrScope.trim().length > 0) {
    return { kind: 'project', projectPath: projectPathOrScope };
  }
  return activeScope;
}
