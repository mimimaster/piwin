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

  it('includes activity info with tool name in snapshot', () => {
    const store = createPetStateStore({ basePet });
    store.reduce({ type: 'tool/start', toolCallId: 't1', toolName: 'read_file' } as AgentEvent);
    const snap = store.snapshot();
    expect(snap.pet.state).toBe('running');
    expect(snap.pet.activity?.toolName).toBe('read_file');
  });

  it('omits activity when idle', () => {
    const store = createPetStateStore({ basePet });
    expect(store.snapshot().pet.activity).toBeUndefined();
  });

  it('notifies subscribers when the base pet is swapped (pet/set-active)', () => {
    const store = createPetStateStore({ basePet });
    const seen: string[] = [];
    store.subscribe((snap) => seen.push(snap.pet.petId));
    store.setBase({ ...basePet, petId: 'other-pet', spritesheetAbsolutePath: '/y/sheet.png' });
    expect(seen).toEqual(['other-pet']);
    expect(store.snapshot().pet.spritesheetAbsolutePath).toBe('/y/sheet.png');
  });

  it('preserves the live animation state when the base pet is swapped', () => {
    const store = createPetStateStore({ basePet });
    store.reduce({ type: 'message/start', messageId: 'm1', role: 'assistant' } as AgentEvent);
    const seen: string[] = [];
    store.subscribe((snap) => seen.push(snap.pet.state));
    store.setBase({ ...basePet, petId: 'other-pet' });
    expect(seen).toEqual(['running']);
  });

  it('does not notify when setBase is called with the same pet', () => {
    const store = createPetStateStore({ basePet });
    const seen: string[] = [];
    store.subscribe((snap) => seen.push(snap.pet.petId));
    store.setBase({ ...basePet });
    expect(seen).toEqual([]);
  });

  it('notifies subscribers when tool name changes but state stays running', () => {
    const store = createPetStateStore({ basePet });
    const tools: string[] = [];
    store.subscribe((snap) => tools.push(snap.pet.activity?.toolName ?? ''));
    store.reduce({ type: 'tool/start', toolCallId: 't1', toolName: 'read_file' } as AgentEvent);
    store.reduce({ type: 'tool/end', toolCallId: 't1', isError: false } as AgentEvent);
    store.reduce({ type: 'tool/start', toolCallId: 't2', toolName: 'write_file' } as AgentEvent);
    expect(tools).toEqual(['read_file', '', 'write_file']);
  });
});
