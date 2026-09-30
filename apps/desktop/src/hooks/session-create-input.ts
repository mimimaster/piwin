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
import type { ModelRef, ThinkingLevel } from '@piwin/contracts';
import {
  sessionCreateInputForTransport,
  type DesktopHostTransport,
  type SessionCreateInputPayload,
} from '../remote-session-hydrate.js';

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
  const isExternalAgent = draft.agentId !== undefined && draft.agentId !== 'pi';

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
