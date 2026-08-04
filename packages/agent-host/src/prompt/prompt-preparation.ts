/** Host-owned prompt preparation: media routing policy (spec Phase 4). */

import type { PromptAttachment } from '@piwin/contracts';

export type MediaRoutingDecision =
  | { mode: 'native'; images: { data: string; mimeType: string }[] }
  | { mode: 'delegated-description'; injections: { text: string; path?: string }[] }
  | { mode: 'path-fallback'; injections: { text: string; path: string }[] }
  | { mode: 'error'; message: string };

export type PreparePromptInput = {
  text: string;
  attachments: PromptAttachment[];
  primarySupportsImage: boolean;
  /** Text-only fallback is opt-in via Settings; false blocks path injection. */
  allowPathFallback: boolean;
};

/** Extract media attachments (web-element picks are text-injected separately). */
export function extractMediaAttachments(
  attachments: PromptAttachment[] | undefined,
): Extract<PromptAttachment, { kind: 'media' }>[] {
  if (!attachments) {
    return [];
  }
  return attachments.filter((attachment) => attachment.kind === 'media');
}

/**
 * Decide how to route media for one prompt. Never mixes absolute paths into
 * native text prompts; delegation results inject descriptions, not paths.
 */
export function decideMediaRouting(input: PreparePromptInput): MediaRoutingDecision {
  const mediaAttachments = extractMediaAttachments(input.attachments);
  if (mediaAttachments.length === 0) {
    return { mode: 'native', images: [] };
  }

  if (input.primarySupportsImage) {
    return {
      mode: 'native',
      images: mediaAttachments.map((attachment) => ({
        data: attachment.path,
        mimeType: attachment.mimeType,
      })),
    };
  }

  if (input.allowPathFallback) {
    return {
      mode: 'path-fallback',
      injections: mediaAttachments.map((attachment) => ({
        text: `[attached image: ${attachment.path}]`,
        path: attachment.path,
      })),
    };
  }

  return {
    mode: 'error',
    message:
      'Primary model is text-only and path fallback is disabled. Enable vision delegation or a vision model to attach images.',
  };
}

export function formatVisionDescriptionInjection(entry: {
  absolutePath: string;
  mimeType: string;
  description: string;
}): string {
  return `[image: ${entry.absolutePath} (${entry.mimeType}) — vision description: ${entry.description}]`;
}

export function pathInjectMediaAttachment(
  attachment: Extract<PromptAttachment, { kind: 'media' }>,
): string {
  return `[attached image: ${attachment.path}]`;
}
