/**
 * Relabel a provider 4xx as an image-input rejection when the turn sent
 * native images. The provider prose varies by vendor (GLM answers
 * "messages.content.type 参数非法"), so the Host decides from facts it owns:
 * images went out natively, and the request itself was rejected.
 */

import type { AgentFailure, AgentPromptOutcome, PromptInput } from '@piwin/contracts';
import { sanitizeAgentFailure } from '@piwin/contracts';
import { isNativeImageAttachment } from '../prompt-media-attachments.js';

/** Request-shape rejections. 413 (too large) is a size problem, not modality. */
const IMAGE_REJECTION_STATUSES: ReadonlySet<number> = new Set([400, 415, 422]);

export function promptSentNativeImages(input: PromptInput): boolean {
  return (input.attachments ?? []).some(
    (attachment) => attachment.kind === 'media' && isNativeImageAttachment(attachment),
  );
}

export function relabelImageInputFailure(
  failure: AgentFailure,
  sentNativeImages: boolean,
): AgentFailure {
  if (!sentNativeImages) return failure;
  if (failure.code !== 'provider-http-error') return failure;
  if (failure.httpStatus === undefined || !IMAGE_REJECTION_STATUSES.has(failure.httpStatus)) {
    return failure;
  }
  // Same request will fail again; retry only after the model's image flag changes.
  return sanitizeAgentFailure({ ...failure, code: 'provider-image-input-rejected', retriable: false });
}

export function relabelImageInputOutcome(
  outcome: AgentPromptOutcome,
  sentNativeImages: boolean,
): AgentPromptOutcome {
  if (outcome.status !== 'failed') return outcome;
  const failure = relabelImageInputFailure(outcome.failure, sentNativeImages);
  return failure === outcome.failure ? outcome : { ...outcome, failure };
}
