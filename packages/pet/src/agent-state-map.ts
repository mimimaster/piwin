/**
 * Map normalized AgentEvent stream into a pet animation state.
 * Pure reducer — no DOM.
 */
import type { AgentEvent, PetAnimationState } from '@piwin/contracts';

export type PetAgentContext = {
  state: PetAnimationState;
  streaming: boolean;
  activeTools: number;
  lastError: boolean;
  waitingPermission: boolean;
};

export function createInitialPetAgentContext(): PetAgentContext {
  return {
    state: 'idle',
    streaming: false,
    activeTools: 0,
    lastError: false,
    waitingPermission: false,
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
      break;
    case 'tool/end':
      next.activeTools = Math.max(0, next.activeTools - 1);
      if (event.isError) next.lastError = true;
      break;
    case 'permission/request':
      next.waitingPermission = true;
      break;
    case 'permission/resolved':
      next.waitingPermission = false;
      break;
    case 'error':
      next.lastError = true;
      next.streaming = false;
      break;
    case 'session/ended':
      next.streaming = false;
      next.activeTools = 0;
      next.waitingPermission = false;
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
  });
}
