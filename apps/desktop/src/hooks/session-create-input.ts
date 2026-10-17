/**
 * Assembles the `session/create` payload for the Desktop composer (ADR 0082).
 *
 * Split out of `use-session-actions` so the backend-identity rules live in one
 * named place:
 *   - a session bound to an external agent carries `agentId` (+ that agent's
 *     model/effort ids) and must NOT also carry a Pi `model`/`thinkingLevel`,
 *     because Pi refs mean nothing to another runtime;
 *   - a Pi session keeps the existing composer model/thinking behaviour.
 */
import type { ModelRef, SessionScope, ThinkingLevel } from '@piwin/contracts';
import {
  sessionCreateInputForTransport,
  type DesktopHostTransport,
  type SessionCreateInputPayload,
} from '../remote-session-hydrate.js';

export function isExternalAgentId(agentId: string | undefined): boolean {
  return agentId !== undefined && agentId !== '' && agentId !== 'pi';
}

/**
 * Empty-stage / composer Grok pick while a project is merely open: leave that
 * folder and start Loose. Folder `+` sets an explicit project draft and stays.
 */
export function shouldMoveExternalDraftToConversations(input: {
  agentId?: string;
  activeSessionId?: string | null;
  activeScopeKind: 'general' | 'project';
  explicitDraftScopeKind?: 'general' | 'project' | null;
}): boolean {
  if (!isExternalAgentId(input.agentId) || input.activeSessionId) {
    return false;
  }
  if (input.explicitDraftScopeKind === 'project') {
    return false;
  }
  return input.activeScopeKind === 'project';
}

/**
 * First-send location for an unsent draft. Ambient project scope is not a
 * Grok binding; only folder `+` (`explicitDraftScope.kind === 'project'`) is.
 */
export function resolveDraftCreateScopeForAgent(input: {
  agentId?: string;
  draftScope: SessionScope;
  explicitDraftScope?: SessionScope | null;
}): SessionScope {
  if (!isExternalAgentId(input.agentId)) {
    return input.draftScope;
  }
  if (input.explicitDraftScope?.kind === 'project') {
    return input.explicitDraftScope;
  }
  return { kind: 'general' };
}

/**
 * Where a new session lands when the caller has not already resolved scope.
 *
 * An explicit project (folder + / `projectPath`) stays a project session.
 * Grok and other external agents with no project binding default to
 * Conversations (Loose), instead of inheriting the currently open project
 * and jumping to the top of that folder.
 */
export function resolveSessionCreateLocation(input: {
  requestedScope?: SessionScope;
  projectPath?: string;
  agentId?: string;
  activeScope: SessionScope;
}): { useGeneral: true } | { useGeneral: false; projectKey: string } {
  if (input.requestedScope?.kind === 'general') {
    return { useGeneral: true };
  }
  if (input.requestedScope?.kind === 'project') {
    return { useGeneral: false, projectKey: input.requestedScope.projectPath };
  }
  const explicitProject = input.projectPath?.trim();
  if (explicitProject) {
    return { useGeneral: false, projectKey: explicitProject };
  }
  if (isExternalAgentId(input.agentId) || input.activeScope.kind === 'general') {
    return { useGeneral: true };
  }
  return { useGeneral: false, projectKey: input.activeScope.projectPath };
}

export type SessionCreateDraft = {
  /** Scope resolution already decided by the caller. */
  useGeneral: boolean;
  /** Project key (path or opaque remote id) for a project-scoped create. */
  projectKey?: string;
  sessionName?: string;
  /** External agent backend (ADR 0082); absent means Pi. */
  agentId?: string;
  backendModelId?: string;
  backendEffortId?: string;
  /** Pi composer profile, used only when no external agent is selected. */
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  knowledgeBaseIds?: readonly string[];
  disabledMcpServerIds?: readonly string[];
};

export function buildSessionCreateInput(
  transport: DesktopHostTransport,
  draft: SessionCreateDraft,
): SessionCreateInputPayload {
  const isExternalAgent = isExternalAgentId(draft.agentId);

  const input = sessionCreateInputForTransport(transport, {
    useGeneral: draft.useGeneral,
    ...(draft.projectKey !== undefined ? { projectKey: draft.projectKey } : {}),
    ...(draft.sessionName !== undefined ? { sessionName: draft.sessionName } : {}),
    ...(isExternalAgent ? { agentId: draft.agentId } : {}),
    ...(isExternalAgent && draft.backendModelId !== undefined
      ? { backendModelId: draft.backendModelId }
      : {}),
    ...(isExternalAgent && draft.backendEffortId !== undefined
      ? { backendEffortId: draft.backendEffortId }
      : {}),
    // Pi model refs are only meaningful to the Pi backend.
    ...(!isExternalAgent && draft.model !== undefined ? { model: draft.model } : {}),
    ...(!isExternalAgent && draft.thinkingLevel !== undefined
      ? { thinkingLevel: draft.thinkingLevel }
      : {}),
  });

  if (draft.knowledgeBaseIds && draft.knowledgeBaseIds.length > 0) {
    input.knowledgeBaseIds = [...draft.knowledgeBaseIds];
  }
  if (draft.disabledMcpServerIds && draft.disabledMcpServerIds.length > 0) {
    input.disabledMcpServerIds = [...draft.disabledMcpServerIds];
  }
  return input;
}
