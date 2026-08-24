/**
 * One-shot Canvas auto-reveal for a live Assistant completion.
 *
 * Eligibility is the tracker having observed the message while `streaming`.
 * Hydrated history, session switch, blocked/error Artifacts, and Inline never
 * open Canvas. Multiple Canvas fences in one message open the last.
 * `artifactCodeFirst` is not an input — it is Inline-only.
 *
 * Targets come from `collectArtifactCanvasTargets` (canonical fence index +
 * analyzeArtifactFence). Completion does not run a second Markdown parser.
 */

import type { ChatMessageUi } from './chat-reducer';
import { collectArtifactCanvasTargets, type ArtifactCanvasTarget } from './artifact-canvas-model';

export type ArtifactCanvasAutoRevealState = {
  sessionId: string | null;
  pendingMessageIds: ReadonlySet<string>;
};

export type ArtifactCanvasAutoRevealInput = {
  sessionId: string | null;
  messages: readonly Pick<ChatMessageUi, 'id' | 'role' | 'status' | 'text'>[];
  /** Master switch: `config.artifact.enabled`. */
  enabled: boolean;
  maxBytes?: number;
};

export type ArtifactCanvasAutoRevealResult = {
  state: ArtifactCanvasAutoRevealState;
  target: ArtifactCanvasTarget | null;
};

export function createArtifactCanvasAutoRevealState(): ArtifactCanvasAutoRevealState {
  return { sessionId: null, pendingMessageIds: new Set() };
}

function lastCanvasTarget(input: {
  sessionId: string;
  messageId: string;
  markdown: string;
  maxBytes?: number;
}): ArtifactCanvasTarget | null {
  const targets = collectArtifactCanvasTargets({
    sessionId: input.sessionId,
    messageId: input.messageId,
    markdown: input.markdown,
    ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
  });
  return targets.at(-1) ?? null;
}

export function advanceArtifactCanvasAutoReveal(
  state: ArtifactCanvasAutoRevealState,
  input: ArtifactCanvasAutoRevealInput,
): ArtifactCanvasAutoRevealResult {
  const pendingMessageIds = new Set(
    state.sessionId === input.sessionId ? state.pendingMessageIds : [],
  );
  let target: ArtifactCanvasTarget | null = null;

  for (const message of input.messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    if (message.status === 'streaming') {
      pendingMessageIds.add(message.id);
      continue;
    }
    if (!pendingMessageIds.delete(message.id)) {
      continue;
    }
    if (message.status !== 'done' || !input.enabled || input.sessionId === null) {
      continue;
    }
    target =
      lastCanvasTarget({
        sessionId: input.sessionId,
        messageId: message.id,
        markdown: message.text,
        ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
      }) ?? target;
  }

  return {
    state: { sessionId: input.sessionId, pendingMessageIds },
    target,
  };
}
