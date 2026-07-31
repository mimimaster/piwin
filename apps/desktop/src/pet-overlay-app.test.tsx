// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_PET_STATE_ROWS, type PetRuntimeSnapshot } from '@piwin/contracts';
import { PetOverlayApp } from './pet-overlay-app';

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('./components/PetSprite', () => ({
  PetSprite: (props: { pet: PetRuntimeSnapshot }) => (
    <div data-testid="pet-sprite" data-state={props.pet.state} />
  ),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createPet(): PetRuntimeSnapshot {
  return {
    petId: 'test-pet',
    displayName: 'Test Pet',
    spritesheetAbsolutePath: '/tmp/spritesheet.webp',
    state: 'idle',
    fps: 6,
    cellWidth: 192,
    cellHeight: 208,
    cols: 8,
    rows: 9,
    stateRows: { ...DEFAULT_PET_STATE_ROWS },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('PetOverlayApp', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    listenMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listenMock.mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('registers the push listener before fetching the initial state', async () => {
    const callOrder: string[] = [];
    listenMock.mockImplementation(async () => {
      callOrder.push('listen');
      return vi.fn();
    });
    invokeMock.mockImplementation(async () => {
      callOrder.push('invoke');
      return { success: true, data: { pet: createPet() } };
    });

    act(() => {
      root.render(<PetOverlayApp />);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(callOrder).toEqual(['listen', 'invoke']);
    expect(container.querySelector('[data-testid="pet-sprite"]')).not.toBeNull();
  });

  it('retries the initial state request when the host is not ready yet', async () => {
    vi.useFakeTimers();
    invokeMock
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true, data: { pet: createPet() } });

    act(() => {
      root.render(<PetOverlayApp />);
    });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="pet-sprite"]')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="pet-sprite"]')).not.toBeNull();
  });
});
