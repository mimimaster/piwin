// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_PET_STATE_ROWS, type PetRuntimeSnapshot } from '@piwin/contracts';
import { PetOverlayApp } from './pet-overlay-app';

const invokeMock = vi.fn();
const listenMock = vi.fn();
const emitMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
  emit: emitMock,
}));

vi.mock('./components/PetSprite', () => ({
  PetSprite: (props: { pet: PetRuntimeSnapshot; onHide?: () => void }) => (
    <div className="pet-sprite-root" data-testid="pet-sprite" data-state={props.pet.state}>
      <button
        type="button"
        data-pet-overlay-control="hide"
        data-testid="hide-pet"
        onClick={props.onHide}
      >
        hide
      </button>
    </div>
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

type PetStatePushHandler = (event: { payload: { pet: PetRuntimeSnapshot } }) => void;

describe('PetOverlayApp', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;
  let petStatePushHandler: PetStatePushHandler | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    listenMock.mockReset();
    emitMock.mockReset();
    petStatePushHandler = undefined;
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listenMock.mockImplementation(async (event: string, handler: PetStatePushHandler) => {
      if (event === 'pet-state-push') {
        petStatePushHandler = handler;
      }
      return vi.fn();
    });
    emitMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    localStorage.clear();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  async function deliverPet(pet: PetRuntimeSnapshot = createPet()): Promise<void> {
    const handler = petStatePushHandler;
    if (!handler) throw new Error('pet-state-push listener was not registered');
    await act(async () => {
      handler({ payload: { pet } });
      await flushMicrotasks();
    });
  }

  it('asks the main window for pet state instead of calling the Host sidecar', async () => {
    const callOrder: string[] = [];
    listenMock.mockImplementation(async (event: string, handler: PetStatePushHandler) => {
      callOrder.push('listen');
      if (event === 'pet-state-push') {
        petStatePushHandler = handler;
      }
      return vi.fn();
    });
    emitMock.mockImplementation(async (event: string) => {
      callOrder.push(`emit:${event}`);
    });

    act(() => {
      root.render(<PetOverlayApp />);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(callOrder).toEqual(['listen', 'emit:pet-overlay-request-state']);
    expect(invokeMock).not.toHaveBeenCalledWith(
      'host_request',
      expect.objectContaining({ command: { type: 'pet/get-active' } }),
    );
    expect(container.querySelector('[data-testid="pet-sprite"]')).toBeNull();

    await deliverPet();
    expect(container.querySelector('[data-testid="pet-sprite"]')).not.toBeNull();
  });

  it('retries the overlay state request until the main window replies', async () => {
    vi.useFakeTimers();

    act(() => {
      root.render(<PetOverlayApp />);
    });
    await act(async () => {
      await flushMicrotasks();
    });
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith('pet-overlay-request-state');
    expect(container.querySelector('[data-testid="pet-sprite"]')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(emitMock).toHaveBeenCalledTimes(2);
    await deliverPet();
    expect(container.querySelector('[data-testid="pet-sprite"]')).not.toBeNull();
  });

  it('cancels the Canvas drag default before WebKit can paint a selection highlight', async () => {
    act(() => {
      root.render(<PetOverlayApp />);
    });
    await act(async () => {
      await flushMicrotasks();
    });
    await deliverPet();

    const sprite = container.querySelector<HTMLElement>('[data-testid="pet-sprite"]');
    if (!sprite) throw new Error('pet sprite not rendered');
    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    sprite.dispatchEvent(mouseDown);

    expect(mouseDown.defaultPrevented).toBe(true);
  });

  it('persists and applies hide from the pet hover control', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke: invokeMock },
    });
    invokeMock.mockResolvedValue(undefined);

    act(() => {
      root.render(<PetOverlayApp />);
    });
    await act(async () => {
      await flushMicrotasks();
    });
    await deliverPet();

    const hideButton = container.querySelector<HTMLButtonElement>('[data-testid="hide-pet"]');
    if (!hideButton) throw new Error('hide pet control not rendered');
    act(() => {
      hideButton.click();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(invokeMock).not.toHaveBeenCalledWith('pet_overlay_show');
    expect(invokeMock).toHaveBeenCalledWith('pet_overlay_hide');
    expect(localStorage.getItem('piwin.desktop.petOverlayVisible')).toBe('false');
  });

  it('does not re-show itself on boot when the preference is already visible', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke: invokeMock },
    });
    localStorage.setItem('piwin.desktop.petOverlayVisible', 'true');
    invokeMock.mockResolvedValue(undefined);

    act(() => {
      root.render(<PetOverlayApp />);
    });
    await act(async () => {
      await flushMicrotasks();
    });
    await deliverPet();

    expect(invokeMock).not.toHaveBeenCalledWith('pet_overlay_show');
    expect(invokeMock).not.toHaveBeenCalledWith(
      'host_request',
      expect.objectContaining({ command: { type: 'pet/get-active' } }),
    );
  });

  it('closes a stale overlay page when the saved preference is hidden', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke: invokeMock },
    });
    localStorage.setItem('piwin.desktop.petOverlayVisible', 'false');
    invokeMock.mockResolvedValue(undefined);

    act(() => {
      root.render(<PetOverlayApp />);
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(invokeMock).toHaveBeenCalledWith('pet_overlay_hide');
    expect(invokeMock).not.toHaveBeenCalledWith('pet_overlay_show');
  });
});
