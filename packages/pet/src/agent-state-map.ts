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
      break;
    case 'tool/end':
      next.activeTools = Math.max(0, next.activeTools - 1);
      if (event.isError) next.lastError = true;
      if (next.activeTools === 0) next.activeToolName = null;
      break;
    case 'permission/request':
      next.waitingPermission = true;
      next.permissionAction = event.action;
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
  });
}
