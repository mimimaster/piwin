import { describe, expect, it } from 'vitest';
import { DEFAULT_PET_STATE_ROWS, type PetRuntimeSnapshot } from '@piwin/contracts';
import { buildPetBubbleView } from './pet-bubble-view.js';

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

describe('buildPetBubbleView', () => {
  it('returns null when idle', () => {
    expect(buildPetBubbleView(createPet(), 'en')).toBeNull();
  });

  it('shows stable tool work with verb + detail (no rotating fluff)', () => {
    const view = buildPetBubbleView(
      createPet({
        state: 'running',
        activity: {
          toolName: 'read',
          phase: 'tool-running',
          detail: 'apps/desktop/src/App.tsx',
          actionVerb: 'Read',
        },
      }),
      'en',
    );
    expect(view).not.toBeNull();
    expect(view?.statusKind).toBe('working');
    expect(view?.statusLabel).toBe('Running');
    expect(view?.headline).toBe('Read');
    expect(view?.detail).toContain('App.tsx');
  });

  it('localizes verb and status for zh-CN', () => {
    const view = buildPetBubbleView(
      createPet({
        state: 'running',
        activity: {
          toolName: 'read',
          phase: 'tool-running',
          detail: 'packages/pet/src/index.ts',
          actionVerb: 'Read',
        },
      }),
      'zh-CN',
    );
    expect(view?.statusLabel).toBe('运行中');
    expect(view?.headline).toBe('读取');
    expect(view?.detail).toContain('index.ts');
  });

  it('shows thinking status while streaming without a tool', () => {
    const view = buildPetBubbleView(
      createPet({
        state: 'running',
        activity: { phase: 'waiting-first-token' },
      }),
      'en',
    );
    expect(view?.statusKind).toBe('thinking');
    expect(view?.statusLabel).toBe('Thinking');
    expect(view?.headline.length).toBeGreaterThan(0);
  });

  it('shows waiting approval with permission detail', () => {
    const view = buildPetBubbleView(
      createPet({
        state: 'waiting',
        activity: {
          permissionAction: 'bash',
          phase: 'waiting-permission',
          detail: 'rm -rf /tmp/x',
        },
      }),
      'en',
    );
    expect(view?.statusKind).toBe('waiting');
    expect(view?.detail).toContain('rm -rf');
  });
});
