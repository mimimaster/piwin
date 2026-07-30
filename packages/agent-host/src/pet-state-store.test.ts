import { describe, expect, it } from 'vitest';
import type { AgentEvent, PetRuntimeSnapshot } from '@piwin/contracts';
import { createPetStateStore } from './pet-state-store.js';

const basePet: PetRuntimeSnapshot = {
  petId: 'piwin-default',
  displayName: 'Piwin',
  spritesheetAbsolutePath: '/x/sheet.png',
  state: 'idle',
  fps: 6,
  cellWidth: 48,
  cellHeight: 52,
  cols: 8,
  rows: 9,
  stateRows: {
    idle: 0,
    running: 1,
    waiting: 2,
    failed: 3,
    waving: 4,
    jumping: 5,
    review: 6,
  },
};

describe('createPetStateStore', () => {
  it('starts idle and reflects base pet', () => {
    const store = createPetStateStore({ basePet });
    expect(store.snapshot().pet.state).toBe('idle');
    expect(store.snapshot().pet.petId).toBe('piwin-default');
  });

  it('transitions to running on assistant message/start', () => {
    const store = createPetStateStore({ basePet });
    store.reduce({ type: 'message/start', messageId: 'm1', role: 'assistant' } as AgentEvent);
    expect(store.snapshot().pet.state).toBe('running');
  });

  it('transitions to waiting on permission/request', () => {
    const store = createPetStateStore({ basePet });
    store.reduce({
      type: 'permission/request',
      requestId: 'p1',
      action: 'bash',
      detail: 'rm',
      defaultDecision: 'ask',
    } as AgentEvent);
    expect(store.snapshot().pet.state).toBe('waiting');
  });

  it('notifies subscribers on state change', () => {
    const store = createPetStateStore({ basePet });
    const seen: string[] = [];
    store.subscribe((snap) => seen.push(snap.pet.state));
    store.reduce({ type: 'message/start', messageId: 'm1', role: 'assistant' } as AgentEvent);
    store.reduce({ type: 'message/end', messageId: 'm1' } as AgentEvent);
    expect(seen).toEqual(['running', 'idle']);
  });

  it('does not notify when state is unchanged', () => {
    const store = createPetStateStore({ basePet });
    const seen: string[] = [];
    store.subscribe((snap) => seen.push(snap.pet.state));
    store.reduce({ type: 'session/started', sessionId: 's1' } as AgentEvent);
    expect(seen).toEqual([]);
  });
});
