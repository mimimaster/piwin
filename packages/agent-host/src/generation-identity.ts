/**
 * Generation-scoped Agent event identity normalization (ADR 0040 §7).
 *
 * A reconstructed Pi backend owns a fresh event mapper, so synthesized ids
 * such as `pi-message-2` restart in each runtime generation. Treating a naked
 * repeated message id as replay can append a new answer and tool cards to an
 * old transcript row, leaving the newest user turn apparently unanswered.
 *
 * Every backend identity is normalized with the stable product `sessionId`
 * plus the `runtimeGenerationId` before it reaches Run correlation, transcript
 * persistence, hooks, or clients:
 *
 * - the same backend identity replayed in the same generation maps to the
 *   same product identity and stays idempotent;
 * - the same backend identity emitted by a different generation maps to a
 *   different product identity and creates a new transcript row;
 * - a reconstructed backend never reuses a prior generation's product ids.
 *
 * The resulting id is opaque; clients must not parse its string form.
 */

import { createHash } from 'node:crypto';
import { LEGACY_IMPORT_GENERATION, USER_AUTHORED_GENERATION } from '@piwin/contracts';

export { LEGACY_IMPORT_GENERATION, USER_AUTHORED_GENERATION };

/** Stable context for one runtime generation of one product session. */
export type GenerationIdentityContext = {
  sessionId: string;
  runtimeGenerationId: string;
};

/** Prefix for opaque product message ids. */
const MESSAGE_ID_PREFIX = 'piw-m';

/** Prefix for opaque product tool-call ids. */
const TOOL_CALL_ID_PREFIX = 'piw-t';

/** Prefix for opaque product permission-request ids. */
const PERMISSION_REQUEST_ID_PREFIX = 'piw-p';

/**
 * Deterministically derive an opaque product identity from a backend identity
 * within one generation. Deterministic within a generation (so replays map to
 * the same product id) and generation-scoped (so a rebuilt backend with the
 * same naked backend id cannot collide with an older generation's row).
 */
function hashGenerationIdentity(context: GenerationIdentityContext, backendId: string): string {
  return createHash('sha256')
    .update(context.sessionId)
    .update('\u0000')
    .update(context.runtimeGenerationId)
    .update('\u0000')
    .update(backendId)
    .digest('hex')
    .slice(0, 24);
}

/** Opaque product message id for one backend message id in one generation. */
export function normalizeGenerationMessageId(
  context: GenerationIdentityContext,
  backendMessageId: string,
): string {
  return `${MESSAGE_ID_PREFIX}-${hashGenerationIdentity(context, backendMessageId)}`;
}

/** Opaque product tool-call id for one backend tool-call id in one generation. */
export function normalizeGenerationToolCallId(
  context: GenerationIdentityContext,
  backendToolCallId: string,
): string {
  return `${TOOL_CALL_ID_PREFIX}-${hashGenerationIdentity(context, backendToolCallId)}`;
}

/** Opaque product permission-request id for one backend request id. */
export function normalizeGenerationPermissionRequestId(
  context: GenerationIdentityContext,
  backendRequestId: string,
): string {
  return `${PERMISSION_REQUEST_ID_PREFIX}-${hashGenerationIdentity(context, backendRequestId)}`;
}

/**
 * Rewrite message/tool-call/permission identities inside one AgentEvent with
 * the generation-scoped product form. Identity-bearing fields are replaced
 * in place; all other event content is preserved. Events that carry no
 * backend identity pass through unchanged.
 *
 * The input is expected to already carry the *backend* identity. The host
 * adapter applies this after `mapPiSessionEvent` produces normalized events
 * and before they are published as `AgentEvent`.
 */
export function normalizeAgentEventIds(
  event: import('@piwin/contracts').AgentEvent,
  context: GenerationIdentityContext,
): import('@piwin/contracts').AgentEvent {
  switch (event.type) {
    case 'message/start': {
      const backendMessageId = event.backendMessageId ?? event.messageId;
      return {
        ...event,
        backendMessageId,
        messageId: normalizeGenerationMessageId(context, backendMessageId),
      };
    }
    case 'message/text_delta':
    case 'message/text_snapshot':
    case 'message/thinking_delta':
    case 'message/search_evidence':
    case 'message/end': {
      return {
        ...event,
        messageId: normalizeGenerationMessageId(context, event.messageId),
      };
    }
    case 'tool/start':
    case 'tool/update':
    case 'tool/end': {
      return {
        ...event,
        toolCallId: normalizeGenerationToolCallId(context, event.toolCallId),
      };
    }
    case 'permission/request': {
      return {
        ...event,
        requestId: normalizeGenerationPermissionRequestId(context, event.requestId),
      };
    }
    default:
      return event;
  }
}
