import { describe, expect, it } from 'vitest';
import { DEFAULT_PET_STATE_ROWS, type PetRuntimeSnapshot } from '@piwin/contracts';
import { petToActivityInput } from './pet-activity-mapper.js';

function createPet(overrides: Partial<PetRuntimeSnapshot> = {}): PetRuntimeSnapshot {
  return {
    petId: 'test-pet',
    displayName: 'Test Pet',
    spritesheetAbsolutePath: '/tmp/sheet.webp',
    state: 'idle',
    fps: 6,
    cellWidth: 192,
    cellHeight: 208,
    cols: 8,
    rows: 9,
    stateRows: { ...DEFAULT_PET_STATE_ROWS },
    ...overrides,
  };
}

describe('petToActivityInput', () => {
  it('returns null when idle with no activity', () => {
    expect(petToActivityInput(createPet(), 'zh-CN')).toBeNull();
  });

  it('maps running state with tool name to working kind', () => {
    const pet = createPet({
      state: 'running',
      activity: { toolName: 'read_file', phase: 'tool-running' },
    });
    const result = petToActivityInput(pet, 'en');
    expect(result?.kind).toBe('working');
    expect(result?.activeToolName).toBe('read_file');
  });

  it('maps waiting state to waiting-permission', () => {
    const pet = createPet({
      state: 'waiting',
      activity: { permissionAction: 'bash', phase: 'waiting-permission' },
    });
    const result = petToActivityInput(pet, 'zh-CN');
    expect(result?.kind).toBe('waiting-permission');
    expect(result?.actionCategory).toBe('ask');
  });

  it('uses run phase to determine kind when available', () => {
    const pet = createPet({
      state: 'running',
      activity: { phase: 'preparing' },
    });
    expect(petToActivityInput(pet, 'en')?.kind).toBe('preparing');
  });

  it('falls back to animation state when no phase', () => {
    const pet = createPet({ state: 'failed' });
    expect(petToActivityInput(pet, 'en')?.kind).toBe('failed');
  });

  it('passes locale through', () => {
    const pet = createPet({ state: 'running', activity: { phase: 'streaming' } });
    expect(petToActivityInput(pet, 'zh-CN')?.locale).toBe('zh-CN');
    expect(petToActivityInput(pet, 'en')?.locale).toBe('en');
  });
});
