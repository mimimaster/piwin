/**
 * Desktop-local Artifact Canvas target model.
 *
 * A Canvas target carries only raw model source plus stable origin metadata.
 * It deliberately excludes srcdoc, measured height, and theme output — those
 * are rederived from `source` under the current theme/security policy by
 * `ArtifactFrame` so a restored tab never shows stale rendered output.
 *
 * Canvas is message-backed and ephemeral (ADR 0029): no persistence path under
 * ~/.piwin is introduced for Canvas state.
 */

import type { ArtifactDescriptor, ArtifactSurface } from '@piwin/artifact';

export type ArtifactCanvasTarget = {
  /** Stable identity derived from session + message + fence index. */
  id: string;
  /** Owning session at open time; used to clear Canvas on session switch. */
  sessionId: string;
  /** Assistant message that emitted the fence. */
  messageId: string;
  /** Index of the fence within the message Markdown body. */
  fenceIndex: number;
  /** Channel id used by the iframe bridge (matches ArtifactFrame channelId). */
  channelId: string;
  /** Fence-declared routing surface (always 'canvas' for a Canvas target). */
  surface: ArtifactSurface;
  title: string;
  type: 'html' | 'svg';
  rawLanguage: string;
  /** Raw model source — never the wrapped srcdoc. */
  source: string;
};

/**
 * Build a stable Canvas target id from session + message + fence identity.
 * Replaces global `fence-0` style ids so two interactive frames in different
 * messages cannot collide, and a re-opened fence resolves to the same id.
 */
export function buildArtifactCanvasTargetId(
  sessionId: string,
  messageId: string,
  fenceIndex: number,
): string {
  return `canvas:${sessionId}:${messageId}:${fenceIndex}`;
}

/**
 * Construct a Canvas target from a parsed artifact descriptor plus origin
 * metadata. The descriptor surface is preserved as-is; callers should only
 * route `surface === 'canvas'` descriptors through this path.
 */
export function createArtifactCanvasTarget(input: {
  sessionId: string;
  messageId: string;
  fenceIndex: number;
  descriptor: ArtifactDescriptor;
}): ArtifactCanvasTarget {
  const { sessionId, messageId, fenceIndex, descriptor } = input;
  return {
    id: buildArtifactCanvasTargetId(sessionId, messageId, fenceIndex),
    sessionId,
    messageId,
    fenceIndex,
    channelId: descriptor.id,
    surface: descriptor.surface,
    title: descriptor.title,
    type: descriptor.type,
    rawLanguage: descriptor.rawLanguage,
    source: descriptor.source,
  };
}

/**
 * Two targets are the same Canvas slot when their stable ids match. Source
 * content is intentionally excluded from identity so an updated fence (e.g.
 * a regenerated prototype) replaces the active Canvas in place.
 */
export function isSameCanvasTarget(
  current: ArtifactCanvasTarget | null,
  candidate: ArtifactCanvasTarget,
): boolean {
  return current !== null && current.id === candidate.id;
}

/**
 * Pure Composer append helper (ADR 0029 §2.6).
 * - empty draft → proposal text
 * - non-empty draft → trim trailing whitespace, add one newline, append text
 * - never replaces existing draft text and never auto-sends
 */
export function appendComposerProposal(draft: string, proposalText: string): string {
  if (draft.trim().length === 0) {
    return proposalText;
  }
  return `${draft.replace(/\s+$/, '')}\n${proposalText}`;
}
