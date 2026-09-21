/**
 * Canvas auto-reveal for a live Assistant message.
 *
 * Eligibility is the tracker having observed the message while `streaming`.
 * Hydrated history, session switch, blocked Artifacts, and Inline never open
 * Canvas. Multiple Canvas fences in one message open the last.
 * `artifactCodeFirst` is not an input — it is Inline-only.
 *
 * A parseable `surface="canvas"` fence reveals as soon as it appears on a
 * live message. Later tokens with the same target id are updates (source
 * only). Completion updates the same id without a second reveal.
 *
 * Targets come from `collectArtifactCanvasTargets` (canonical fence index +
 * analyzeArtifactFence). Completion does not run a second Markdown parser.
 */

import type { ChatMessageUi, RunTerminalState } from './chat-reducer';
import { collectArtifactCanvasTargets, type ArtifactCanvasTarget } from './artifact-canvas-model';

export type ArtifactCanvasAutoRevealState = {
  sessionId: string | null;
  pendingMessageIds: ReadonlySet<string>;
  /** Last Canvas target id this tracker revealed or updated in the session. */
  liveTargetId: string | null;
};

export type ArtifactCanvasAutoRevealInput = {
  sessionId: string | null;
  messages: readonly Pick<ChatMessageUi, 'id' | 'role' | 'status' | 'text'>[];
  /** Canvas switch of the session's resolved Artifact capability. */
  enabled: boolean;
  maxBytes?: number;
  /**
   * Session run terminal. Abort stamps the assistant row `done` but
   * `stopped` / `failed` must not commit stream-preview → interactive.
   */
  runTerminalKind?: RunTerminalState['kind'];
};

export type ArtifactCanvasAutoRevealAction = 'reveal' | 'update';

export type ArtifactCanvasAutoRevealResult = {
  state: ArtifactCanvasAutoRevealState;
  target: ArtifactCanvasTarget | null;
  action: ArtifactCanvasAutoRevealAction | null;
};

export function createArtifactCanvasAutoRevealState(): ArtifactCanvasAutoRevealState {
  return { sessionId: null, pendingMessageIds: new Set(), liveTargetId: null };
}

function lastCanvasTarget(input: {
  sessionId: string;
  messageId: string;
  markdown: string;
  maxBytes?: number;
  streaming: boolean;
}): ArtifactCanvasTarget | null {
  const targets = collectArtifactCanvasTargets({
    sessionId: input.sessionId,
    messageId: input.messageId,
    markdown: input.markdown,
    mode: input.streaming ? 'stream-preview' : 'interactive',
    ...(input.streaming ? { streaming: true } : {}),
    ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
  });
  return targets.at(-1) ?? null;
}

function shouldCommitCompletedCanvas(input: {
  status: ChatMessageUi['status'];
  runTerminalKind: RunTerminalState['kind'] | undefined;
}): boolean {
  if (input.status !== 'done') {
    return false;
  }
  return input.runTerminalKind !== 'stopped' && input.runTerminalKind !== 'failed';
}

export function advanceArtifactCanvasAutoReveal(
  state: ArtifactCanvasAutoRevealState,
  input: ArtifactCanvasAutoRevealInput,
): ArtifactCanvasAutoRevealResult {
  const sameSession = state.sessionId === input.sessionId;
  const pendingMessageIds = new Set(sameSession ? state.pendingMessageIds : []);
  let liveTargetId = sameSession ? state.liveTargetId : null;
  let target: ArtifactCanvasTarget | null = null;

  for (const message of input.messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    if (message.status === 'streaming') {
      pendingMessageIds.add(message.id);
      if (input.enabled && input.sessionId !== null) {
        const live = lastCanvasTarget({
          sessionId: input.sessionId,
          messageId: message.id,
          markdown: message.text,
          streaming: true,
          ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
        });
        if (live) {
          target = live;
        }
      }
      continue;
    }
    if (!pendingMessageIds.delete(message.id)) {
      continue;
    }
    if (
      !input.enabled ||
      input.sessionId === null ||
      !shouldCommitCompletedCanvas({
        status: message.status,
        runTerminalKind: input.runTerminalKind,
      })
    ) {
      continue;
    }
    target =
      lastCanvasTarget({
        sessionId: input.sessionId,
        messageId: message.id,
        markdown: message.text,
        streaming: false,
        ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
      }) ?? target;
  }

  let action: ArtifactCanvasAutoRevealAction | null = null;
  if (target) {
    action = liveTargetId === target.id ? 'update' : 'reveal';
    liveTargetId = target.id;
  }

  return {
    state: { sessionId: input.sessionId, pendingMessageIds, liveTargetId },
    target,
    action,
  };
}
