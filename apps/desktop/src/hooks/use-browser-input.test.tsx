// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useBrowserInput,
  type BrowserInputHost,
  type UseBrowserInputOptions,
} from './use-browser-input.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

type HookApi = ReturnType<typeof useBrowserInput>;

function Probe(props: {
  options: UseBrowserInputOptions;
  api: { current: HookApi | null };
}): ReactElement {
  props.api.current = useBrowserInput(props.options);
  return <span />;
}

function stubFrame(img: HTMLImageElement): void {
  Object.defineProperty(img, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(img, 'clientHeight', { configurable: true, value: 600 });
  img.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => '',
  });
  img.setPointerCapture = () => undefined;
  img.releasePointerCapture = () => undefined;
  img.hasPointerCapture = () => false;
}

function pointerEvent(
  type: string,
  img: HTMLImageElement,
): React.PointerEvent<HTMLImageElement> {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 20,
    button: 0,
    pointerId: 1,
  });
  Object.defineProperty(event, 'currentTarget', { value: img });
  return event as unknown as React.PointerEvent<HTMLImageElement>;
}

function mouseClick(img: HTMLImageElement): React.MouseEvent<HTMLImageElement> {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 20,
    button: 0,
  });
  Object.defineProperty(event, 'currentTarget', { value: img });
  return event as unknown as React.MouseEvent<HTMLImageElement>;
}

describe('useBrowserInput', () => {
  let container: HTMLDivElement;
  let root: Root;
  let img: HTMLImageElement;
  let imgRef: { current: HTMLImageElement | null };
  let hostClient: BrowserInputHost;
  let browserInput: ReturnType<typeof vi.fn>;
  let browserPickAt: ReturnType<typeof vi.fn>;
  let api: { current: HookApi | null };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    img = document.createElement('img');
    stubFrame(img);
    imgRef = { current: img };
    browserInput = vi.fn().mockResolvedValue(undefined);
    browserPickAt = vi.fn().mockResolvedValue({ success: true });
    hostClient = { browserInput, browserPickAt };
    api = { current: null };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderHook(overrides?: Partial<UseBrowserInputOptions>): HookApi {
    const options: UseBrowserInputOptions = {
      hostClient,
      imgRef,
      viewportWidth: 800,
      viewportHeight: 600,
      interactEnabled: true,
      pickMode: false,
      ...overrides,
    };
    act(() => root.render(<Probe options={options} api={api} />));
    const current = api.current;
    if (!current) throw new Error('hook did not mount');
    return current;
  }

  it('does not send a second down+up when click follows pointerdown/up', () => {
    const input = renderHook();
    act(() => {
      input.onPointerDown(pointerEvent('pointerdown', img));
      input.onPointerUp(pointerEvent('pointerup', img));
      input.onClick(mouseClick(img));
    });
    expect(browserInput).toHaveBeenCalledTimes(2);
    expect(browserInput.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ type: 'mouse', action: 'down', x: 40, y: 20 }),
    ]);
    expect(browserInput.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({ type: 'mouse', action: 'up', x: 40, y: 20 }),
    ]);
  });

  it('still synthesizes a click when the surface never fired pointer events', () => {
    const input = renderHook();
    act(() => {
      input.onClick(mouseClick(img));
    });
    expect(browserInput).toHaveBeenCalledTimes(1);
    expect(browserInput.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ type: 'mouse', action: 'down', x: 40, y: 20 }),
      expect.objectContaining({ type: 'mouse', action: 'up', x: 40, y: 20 }),
    ]);
  });

  it('does not pick twice when click follows a pick-mode pointerup', () => {
    const input = renderHook({ pickMode: true });
    act(() => {
      input.onPointerDown(pointerEvent('pointerdown', img));
      input.onPointerUp(pointerEvent('pointerup', img));
      input.onClick(mouseClick(img));
    });
    expect(browserPickAt).toHaveBeenCalledTimes(1);
    expect(browserInput).not.toHaveBeenCalled();
  });
});
