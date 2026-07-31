// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_PET_STATE_ROWS, type PetRuntimeSnapshot } from '@piwin/contracts';
import { PetBubble } from './PetBubble.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

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

describe('PetBubble', () => {
  let container: HTMLDivElement;
  let root: Root;
  let prevAct: boolean | undefined;

  beforeEach(() => {
    prevAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = prevAct;
  });

  it('renders nothing when pet is idle', () => {
    act(() => {
      root.render(<PetBubble pet={createPet()} />);
    });
    expect(container.querySelector('.pet-bubble')).toBeNull();
  });

  it('renders a phrase when pet is running with a tool', () => {
    const pet = createPet({
      state: 'running',
      activity: { toolName: 'read_file', phase: 'tool-running' },
    });
    act(() => {
      root.render(<PetBubble pet={pet} locale="en" />);
    });
    const bubble = container.querySelector('.pet-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toContain('read_file');
  });

  it('renders Chinese phrase for zh-CN locale', () => {
    const pet = createPet({
      state: 'running',
      activity: { toolName: 'read_file', phase: 'tool-running' },
    });
    act(() => {
      root.render(<PetBubble pet={pet} locale="zh-CN" />);
    });
    const bubble = container.querySelector('.pet-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toContain('read_file');
  });

  it('renders waiting-permission phrase', () => {
    const pet = createPet({
      state: 'waiting',
      activity: { permissionAction: 'bash', phase: 'waiting-permission' },
    });
    act(() => {
      root.render(<PetBubble pet={pet} locale="zh-CN" />);
    });
    const bubble = container.querySelector('.pet-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toBeTruthy();
  });
});
