/**
 * Map normalized AgentEvent stream into a pet animation state.
 * Pure reducer — no DOM.
 */
import type { AgentEvent, PetAnimationState, SessionRunPhase } from '@piwin/contracts';

export type PetAgentContext = {
  state: PetAnimationState;
  streaming: boolean;
  activeTools: number;
  lastError: boolean;
  waitingPermission: boolean;
  /** Name of the most recently started tool, cleared when all tools finish. */
  activeToolName: string | null;
  /** Permission action string while waiting for approval. */
  permissionAction: string | null;
  /** Current run phase (preparing / streaming / tool-running / …). */
  runPhase: SessionRunPhase | null;
  /** ToolPresentation.summary for the active tool (path / command / query). */
  toolDetail: string | null;
  /** ToolPresentation.actionVerb for the active tool (e.g. "Read"). */
  toolActionVerb: string | null;
};

export function createInitialPetAgentContext(): PetAgentContext {
  return {
    state: 'idle',
    streaming: false,
    activeTools: 0,
    lastError: false,
    waitingPermission: false,
    activeToolName: null,
    permissionAction: null,
    runPhase: null,
    toolDetail: null,
    toolActionVerb: null,
  };
}

export function reducePetAgentContext(
  context: PetAgentContext,
  event: AgentEvent,
): PetAgentContext {
  const next: PetAgentContext = { ...context };

  switch (event.type) {
    case 'message/start':
      if (event.role === 'assistant') {
        next.streaming = true;
        next.lastError = false;
      }
      break;
    case 'message/end':
      next.streaming = false;
      break;
    case 'tool/start':
      next.activeTools += 1;
      next.lastError = false;
      next.activeToolName = event.toolName;
      next.toolDetail = event.presentation?.summary ?? event.presentation?.command ?? null;
      next.toolActionVerb = event.presentation?.actionVerb ?? null;
      break;
    case 'tool/end':
      next.activeTools = Math.max(0, next.activeTools - 1);
      if (event.isError) next.lastError = true;
      if (next.activeTools === 0) {
        next.activeToolName = null;
        next.toolDetail = null;
        next.toolActionVerb = null;
      }
      break;
    case 'tool/update':
      // Keep the start-time work target (path/command). tool/update presentations
      // often rebuild from stdout only and would clobber a good detail with a
      // dump — only fill in when we still have nothing.
      if (!next.toolDetail) {
        if (event.presentation?.command) {
          next.toolDetail = event.presentation.command;
        } else if (event.presentation?.summary) {
          next.toolDetail = event.presentation.summary;
        }
      }
      if (!next.toolActionVerb && event.presentation?.actionVerb) {
        next.toolActionVerb = event.presentation.actionVerb;
      }
      break;
    case 'permission/request':
      next.waitingPermission = true;
      next.permissionAction = event.action;
      // Prefer the permission detail (often the command / path) for the bubble.
      if (event.detail.trim()) {
        next.toolDetail = event.detail.trim();
      }
      break;
    case 'permission/resolved':
      next.waitingPermission = false;
      next.permissionAction = null;
      break;
    case 'run/phase':
      next.runPhase = event.phase;
      break;
    case 'error':
      next.lastError = true;
      next.streaming = false;
      break;
    case 'session/ended':
      next.streaming = false;
      next.activeTools = 0;
      next.waitingPermission = false;
      next.activeToolName = null;
      next.permissionAction = null;
      next.runPhase = null;
      next.toolDetail = null;
      next.toolActionVerb = null;
      break;
    case 'compaction/start':
      next.streaming = true;
      break;
    case 'compaction/end':
      next.streaming = false;
      break;
    default:
      break;
  }

  next.state = derivePetAnimationState(next);
  return next;
}

export function derivePetAnimationState(context: PetAgentContext): PetAnimationState {
  if (context.lastError) return 'failed';
  if (context.waitingPermission) return 'waiting';
  if (context.activeTools > 0) return 'running';
  if (context.streaming) return 'running';
  return 'idle';
}

/** Convenience: map desktop chat flags without full event history. */
export function petStateFromChatFlags(input: {
  streaming: boolean;
  toolRunning: boolean;
  hasError: boolean;
  waitingPermission: boolean;
}): PetAnimationState {
  return derivePetAnimationState({
    state: 'idle',
    streaming: input.streaming,
    activeTools: input.toolRunning ? 1 : 0,
    lastError: input.hasError,
    waitingPermission: input.waitingPermission,
    activeToolName: null,
    permissionAction: null,
    runPhase: null,
    toolDetail: null,
    toolActionVerb: null,
  });
}
