/**
 * Host-owned model payload for a Run intervention. Context refs and
 * attachments are resolved here — never by Pi during steer injection.
 */
import type {
  BackendRunIntervention,
  PromptInput,
  RunInterventionRecord,
  UserInstructionPayload,
} from '@piwin/contracts';
import {
  formatError,
  RUN_INTERVENTION_MAX_PENDING_BYTES_PER_RUN,
  RUN_INTERVENTION_MAX_TEXT_BYTES,
} from '@piwin/contracts';
import { resolvePromptContextRefs } from '../prompt/resolve-prompt-context-refs.js';
import { loadPromptImages } from '../prompt-images.js';
import { createResolveRefsDeps } from './prompt-preparation.js';
import type { SessionLiveContext } from './session-live-context.js';

export type PreparedRunIntervention = {
  preparedText: string;
  images: NonNullable<BackendRunIntervention['images']>;
};

export function instructionPayloadFromPromptInput(input: PromptInput): UserInstructionPayload {
  const payload: UserInstructionPayload = { text: input.text };
  if (input.attachments && input.attachments.length > 0) {
    payload.attachments = input.attachments;
  }
  if (input.contextRefs && input.contextRefs.length > 0) {
    payload.contextRefs = input.contextRefs;
  }
  return payload;
}

export function sameInstructionPayload(
  left: UserInstructionPayload,
  right: UserInstructionPayload,
): boolean {
  return (
    left.text === right.text &&
    JSON.stringify(left.attachments ?? []) === JSON.stringify(right.attachments ?? []) &&
    JSON.stringify(left.contextRefs ?? []) === JSON.stringify(right.contextRefs ?? [])
  );
}

export function validateRunInterventionInput(input: UserInstructionPayload): string | undefined {
  const hasText = input.text.trim().length > 0;
  const hasAttachments = (input.attachments?.length ?? 0) > 0;
  const hasContextRefs = (input.contextRefs?.length ?? 0) > 0;
  if (!hasText && !hasAttachments && !hasContextRefs) {
    return 'intervention-empty: instruction text is required';
  }
  if (Buffer.byteLength(input.text, 'utf8') > RUN_INTERVENTION_MAX_TEXT_BYTES) {
    return `intervention-too-large: text exceeds ${RUN_INTERVENTION_MAX_TEXT_BYTES} bytes`;
  }
  if (input.text.trimStart().startsWith('/')) {
    return 'intervention-command-unsupported: slash commands must be sent as a normal turn';
  }
  return undefined;
}

export async function prepareRunInterventionPayload(
  context: SessionLiveContext,
  input: UserInstructionPayload,
): Promise<PreparedRunIntervention> {
  const promptInput: PromptInput = {
    text: input.text,
    ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
    ...(input.contextRefs && input.contextRefs.length > 0 ? { contextRefs: input.contextRefs } : {}),
  };
  try {
    context.validatePromptAttachments(promptInput);
  } catch (error) {
    throw new Error(`intervention-attachment-invalid: ${formatError(error)}`);
  }
  const preparedFromHost = await context.buildModelPromptInput(promptInput);
  let preparedText = preparedFromHost.text;
  if (input.contextRefs && input.contextRefs.length > 0) {
    try {
      const resolvedContext = await resolvePromptContextRefs(
        createResolveRefsDeps(context),
        input.contextRefs,
      );
      if (resolvedContext) {
        preparedText = `${resolvedContext}\n\n${preparedText}`.trim();
      }
    } catch (error) {
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `intervention context ref resolve failed: ${formatError(error)}`,
      });
    }
  }
  const loadedImages = await loadPromptImages(preparedFromHost.attachments);
  const images = loadedImages.map((image) => ({
    dataBase64: image.data,
    mimeType: image.mimeType,
  }));
  if (preparedText.trim().length === 0 && images.length === 0) {
    throw new Error('intervention-empty: instruction text is required');
  }
  if (Buffer.byteLength(preparedText, 'utf8') > RUN_INTERVENTION_MAX_PENDING_BYTES_PER_RUN) {
    throw new Error(
      `intervention-too-large: prepared text exceeds ${RUN_INTERVENTION_MAX_PENDING_BYTES_PER_RUN} bytes`,
    );
  }
  return { preparedText, images };
}

export function toBackendRunIntervention(
  record: RunInterventionRecord,
  prepared: PreparedRunIntervention,
): BackendRunIntervention {
  return {
    interventionId: record.interventionId,
    revision: record.revision,
    sessionId: record.sessionId,
    runId: record.runId,
    runtimeGenerationId: record.runtimeGenerationId,
    sequence: record.sequence,
    text: prepared.preparedText,
    ...(prepared.images.length > 0 ? { images: prepared.images } : {}),
  };
}
