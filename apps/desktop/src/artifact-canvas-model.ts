/**
 * Desktop-local Artifact Canvas target model.
 *
 * A Canvas target carries the original render intent plus stable origin
 * metadata. It deliberately excludes srcdoc, measured height, and theme
 * output — those are rederived by `materializeArtifact` under the current
 * theme so a restored tab never shows stale rendered output.
 *
 * Canvas is message-backed and ephemeral (ADR 0029): no persistence path under
 * ~/.piwin is introduced for Canvas state.
 */

import {
  analyzeArtifactFence,
  indexArtifactFences,
  type ArtifactDeclaration,
  type ArtifactDocumentKind,
  type ArtifactRenderIntent,
} from '@piwin/artifact';

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
  /** Canvas targets always render in the fixed workspace viewport. */
  surface: 'canvas';
  title: string;
  type: 'html' | 'svg';
  declaration: ArtifactDeclaration;
  documentKind: ArtifactDocumentKind;
  rawLanguage: string;
  /** Raw model source — never the wrapped srcdoc. */
  source: string;
  /** Original analysis. Panel materializes with the current theme only. */
  intent: ArtifactRenderIntent;
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
 * Construct a Canvas target from a parsed artifact intent plus origin
 * metadata. Both live auto-reveal and the transcript launcher use this exact
 * target shape, so reopening a completed Canvas preserves its stable identity.
 */
export function createArtifactCanvasTarget(input: {
  sessionId: string;
  messageId: string;
  fenceIndex: number;
  intent: ArtifactRenderIntent;
}): ArtifactCanvasTarget {
  const { sessionId, messageId, fenceIndex, intent } = input;
  if (intent.layout !== 'canvas') {
    throw new Error(
      'Canvas targets require layout "canvas"; inline/viewport stay in the transcript',
    );
  }
  const { descriptor } = intent;
  return {
    id: buildArtifactCanvasTargetId(sessionId, messageId, fenceIndex),
    sessionId,
    messageId,
    fenceIndex,
    channelId: descriptor.id,
    surface: 'canvas',
    title: descriptor.title,
    type: descriptor.type,
    declaration: descriptor.declaration,
    documentKind: descriptor.documentKind,
    rawLanguage: descriptor.rawLanguage,
    source: descriptor.source,
    intent,
  };
}

/**
 * Recover renderable Canvas declarations from a completed Assistant message.
 * Uses the same fence index, security policy, surface router, and ordinal as
 * MarkdownCodeFence so automatic reveal cannot create a second interpretation
 * of model output.
 */
export function collectArtifactCanvasTargets(input: {
  sessionId: string;
  messageId: string;
  markdown: string;
  maxBytes?: number;
}): ArtifactCanvasTarget[] {
  const targets: ArtifactCanvasTarget[] = [];

  for (const fence of indexArtifactFences(input.markdown)) {
    const analysis = analyzeArtifactFence(fence, {
      id: `${input.messageId}-artifact-${fence.ordinal}`,
      htmlUiModeEnabled: true,
      mode: 'interactive',
      ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
    });
    if (analysis.kind !== 'intent' || analysis.intent.layout !== 'canvas') {
      continue;
    }
    targets.push(
      createArtifactCanvasTarget({
        sessionId: input.sessionId,
        messageId: input.messageId,
        fenceIndex: fence.ordinal,
        intent: analysis.intent,
      }),
    );
  }

  return targets;
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
