// @vitest-environment happy-dom
/**
 * Browser Session panel tests (ADR 0020 §6).
 *
 * Covers: frame rendering, URL bar navigation, pick-mode coordinate scaling,
 * and pick → composer chip callback. Uses the mock HostClient (transport:
 * 'mock') so no Tauri / real Chromium is required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostPush, HostResponse, WebElementPickResult } from '@piwin/contracts';
import { HostClient } from './host-client';
import { BrowserSessionPanel } from './browser-session-panel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createMockHostClient(): HostClient {
  return new HostClient({ transport: 'mock' });
}

describe('BrowserSessionPanel', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  function renderPanel(props: {
    hostClient: HostClient;
    onAddWebElement?: (pick: WebElementPickResult) => void;
  }): void {
    const tree: ReactElement = (
      <BrowserSessionPanel
        hostClient={props.hostClient}
        onAddWebElement={props.onAddWebElement ?? vi.fn()}
      />
    );
    act(() => {
      root.render(tree);
    });
  }

  function stubImgMetrics(img: HTMLImageElement, width: number, height: number): void {
    Object.defineProperty(img, 'clientWidth', { value: width, configurable: true });
    Object.defineProperty(img, 'clientHeight', { value: height, configurable: true });
  }

  function queryByTestId(testId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  }

  it('renders the panel with a URL bar and placeholder before the first frame', () => {
    const client = createMockHostClient();
    renderPanel({ hostClient: client });

    expect(queryByTestId('browser-session-panel')).not.toBeNull();
    expect(queryByTestId('browser-session-url-input')).not.toBeNull();
    expect(queryByTestId('browser-session-go-btn')).not.toBeNull();
    // No frame yet → placeholder is shown, not the <img>.
    expect(queryByTestId('browser-session-frame')).toBeNull();
  });

  it('keeps a fixed Host CSS viewport and exposes history controls', async () => {
    const client = createMockHostClient();
    const resizeSpy = vi.spyOn(client, 'browserResize');
    const requestSpy = vi.spyOn(client, 'request');
    renderPanel({ hostClient: client });
    expect(queryByTestId('browser-session-back')).not.toBeNull();
    expect(queryByTestId('browser-session-forward')).not.toBeNull();
    expect(resizeSpy).not.toHaveBeenCalled();
    await act(async () => {
      queryByTestId('browser-session-back')?.click();
    });
    expect(requestSpy).toHaveBeenCalledWith({ type: 'browser/back' });
  });

  it('acquires Chromium on mount and releases it when the browser surface unmounts', () => {
    const client = createMockHostClient();
    const startSpy = vi.spyOn(client, 'browserStart');
    const stopSpy = vi.spyOn(client, 'browserStop');
    renderPanel({ hostClient: client });

    expect(startSpy).toHaveBeenCalledTimes(1);
    const leaseId = startSpy.mock.calls[0]?.[0];
    expect(leaseId).toEqual(expect.any(String));

    act(() => {
      root.render(<div data-testid="browser-replacement" />);
    });

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledWith(leaseId);
  });

  it('navigates via the URL bar using normalizeUrl and calls browser/navigate', async () => {
    const client = createMockHostClient();
    const navigateSpy = vi.spyOn(client, 'browserNavigate');
    renderPanel({ hostClient: client });

    const input = queryByTestId('browser-session-url-input') as HTMLInputElement;
    const form = input.closest('form') as HTMLFormElement;

    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      nativeInputValueSetter?.call(input, 'localhost:3000');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    await act(async () => {
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(navigateSpy).toHaveBeenCalledWith('http://localhost:3000');
  });

  it('disables pick and URL chrome while the agent owns the browser', () => {
    const client = createMockHostClient();
    renderPanel({ hostClient: client });
    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({ type: 'browser/controller', owner: 'agent', agentWantsLock: true, ts: Date.now() });
      }
    });

    const toggle = queryByTestId('browser-session-pick-toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(queryByTestId('browser-session-agent-banner')).not.toBeNull();
    expect((queryByTestId('browser-session-url-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('forwards scaled coordinates on pick-mode click and calls onAddWebElement on browser/picked', async () => {
    const client = createMockHostClient();
    const pickAtSpy = vi.spyOn(client, 'browserPickAt');
    const onAddWebElement = vi.fn();
    renderPanel({ hostClient: client, onAddWebElement });

    // Push a synthetic frame so the <img> renders.
    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    const framePush: HostPush = {
      type: 'browser/frame',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 800,
      height: 600,
      ts: Date.now(),
    };
    act(() => {
      for (const listener of listeners) {
        listener(framePush);
      }
    });

    const img = queryByTestId('browser-session-frame') as HTMLImageElement;
    expect(img).not.toBeNull();

    // Enable pick mode.
    const toggle = queryByTestId('browser-session-pick-toggle') as HTMLButtonElement;
    await act(async () => {
      toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    // Mock the img's clientWidth to simulate a display scale of 0.5
    // (800px natural → 400px displayed). A click at display (200, 150)
    // should forward viewport CSS px (400, 300).
    stubImgMetrics(img, 400, 300);
    img.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => '',
    });

    await act(async () => {
      img.dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: 200,
          clientY: 150,
        }),
      );
    });

    expect(pickAtSpy).toHaveBeenCalledTimes(1);
    const [x, y] = pickAtSpy.mock.calls[0]!;
    expect(x).toBe(400);
    expect(y).toBe(300);

    // The mock backend lives in a deferred chunk; wait for the actual request
    // instead of assuming its import resolves within one microtask.
    const pickRequest = pickAtSpy.mock.results[0]?.value;
    if (!pickRequest) {
      throw new Error('browserPickAt request missing');
    }
    await act(async () => {
      await pickRequest;
    });

    // onAddWebElement should have been called with the pick result.
    expect(onAddWebElement).toHaveBeenCalledTimes(1);
    const pick = onAddWebElement.mock.calls[0]![0] as WebElementPickResult;
    expect(pick.selector).toBe('div.pick-target');
    expect(pick.boundingRect.width).toBe(40);
  });

  it('shows a highlight overlay after a pick result', async () => {
    const client = createMockHostClient();
    const pickAtSpy = vi.spyOn(client, 'browserPickAt');
    renderPanel({ hostClient: client });

    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({
          type: 'browser/frame',
          dataUrl: 'data:image/png;base64,AAAA',
          width: 800,
          height: 600,
          ts: Date.now(),
        } as HostPush);
      }
    });

    const img = queryByTestId('browser-session-frame') as HTMLImageElement;
    stubImgMetrics(img, 800, 600);
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

    // Enable pick mode and click to trigger a pick (mock emits picked).
    const toggle = queryByTestId('browser-session-pick-toggle') as HTMLButtonElement;
    await act(async () => {
      toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      img.dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 300,
        }),
      );
    });
    await act(async () => {
      const pickRequest = pickAtSpy.mock.results[0]?.value;
      if (!pickRequest) {
        throw new Error('browserPickAt request missing');
      }
      await pickRequest;
    });

    const highlight = queryByTestId('browser-session-highlight');
    expect(highlight).not.toBeNull();
  });

  it('offsets the highlight overlay when the frame img is letterboxed in the container', async () => {
    const client = createMockHostClient();
    const pickAtSpy = vi.spyOn(client, 'browserPickAt');
    renderPanel({ hostClient: client });

    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({
          type: 'browser/frame',
          dataUrl: 'data:image/png;base64,AAAA',
          width: 800,
          height: 600,
          ts: Date.now(),
        } as HostPush);
      }
    });

    const containerEl = queryByTestId('browser-session-frame-container') as HTMLDivElement;
    const img = queryByTestId('browser-session-frame') as HTMLImageElement;
    // Scale 1 (clientWidth === naturalWidth). The img is centered: its origin
    // sits 100px right / 50px down inside a 1000x700 container.
    stubImgMetrics(img, 800, 600);
    img.getBoundingClientRect = () => ({
      left: 100,
      top: 50,
      right: 900,
      bottom: 650,
      width: 800,
      height: 600,
      x: 100,
      y: 50,
      toJSON: () => '',
    });
    containerEl.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 700,
      width: 1000,
      height: 700,
      x: 0,
      y: 0,
      toJSON: () => '',
    });

    const toggle = queryByTestId('browser-session-pick-toggle') as HTMLButtonElement;
    await act(async () => {
      toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      img.dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 300,
        }),
      );
    });
    await act(async () => {
      const pickRequest = pickAtSpy.mock.results[0]?.value;
      if (!pickRequest) {
        throw new Error('browserPickAt request missing');
      }
      await pickRequest;
    });

    const highlight = queryByTestId('browser-session-highlight') as HTMLDivElement;
    expect(highlight).not.toBeNull();
    // Click (300,250) display px → viewport (300,250) at scale 1; the mock
    // picked boundingRect is (x-20, y-10) = (280,240). The letterbox offset
    // (100,50) must be added to the container-relative overlay origin.
    expect(highlight.style.left).toBe('380px');
    expect(highlight.style.top).toBe('290px');
  });

  it('clears the pick pending indicator and shows an error when browserPickAt rejects', async () => {
    const client = createMockHostClient();
    const onAddWebElement = vi.fn();
    const pickAtSpy = vi.spyOn(client, 'browserPickAt').mockRejectedValue(new Error('boom'));
    renderPanel({ hostClient: client, onAddWebElement });

    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({
          type: 'browser/frame',
          dataUrl: 'data:image/png;base64,AAAA',
          width: 800,
          height: 600,
          ts: Date.now(),
        } as HostPush);
      }
    });

    const img = queryByTestId('browser-session-frame') as HTMLImageElement;
    stubImgMetrics(img, 800, 600);
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

    const toggle = queryByTestId('browser-session-pick-toggle') as HTMLButtonElement;
    await act(async () => {
      toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      img.dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 300,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(pickAtSpy).toHaveBeenCalledTimes(1);
    // The rejection was handled: pending cleared, inline error shown, and no
    // browser/picked push means no composer chip.
    expect(queryByTestId('browser-session-pick-pending')).toBeNull();
    const errorEl = queryByTestId('browser-session-pick-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain('无法解析该元素');
    expect(onAddWebElement).not.toHaveBeenCalled();
  });

  it('clears the pick pending indicator and shows an error when browserPickAt returns success:false', async () => {
    const client = createMockHostClient();
    const pickAtSpy = vi.spyOn(client, 'browserPickAt').mockResolvedValue({
      type: 'response',
      command: 'browser/pick-at',
      success: false,
      error: 'pick failed',
    } as HostResponse);
    renderPanel({ hostClient: client });

    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({
          type: 'browser/frame',
          dataUrl: 'data:image/png;base64,AAAA',
          width: 800,
          height: 600,
          ts: Date.now(),
        } as HostPush);
      }
    });

    const img = queryByTestId('browser-session-frame') as HTMLImageElement;
    stubImgMetrics(img, 800, 600);
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

    const toggle = queryByTestId('browser-session-pick-toggle') as HTMLButtonElement;
    await act(async () => {
      toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      img.dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: 400,
          clientY: 300,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(pickAtSpy).toHaveBeenCalledTimes(1);
    expect(queryByTestId('browser-session-pick-pending')).toBeNull();
    expect(queryByTestId('browser-session-pick-error')?.textContent).toContain(
      '无法解析该元素',
    );
  });

  it('forwards interact clicks as browser/input instead of pick-at', async () => {
    const client = createMockHostClient();
    const inputSpy = vi.spyOn(client, 'browserInput');
    const pickAtSpy = vi.spyOn(client, 'browserPickAt');
    renderPanel({ hostClient: client });
    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({
          type: 'browser/frame',
          dataUrl: 'data:image/png;base64,AAAA',
          width: 800,
          height: 600,
          ts: Date.now(),
        });
      }
    });
    const img = queryByTestId('browser-session-frame') as HTMLImageElement;
    stubImgMetrics(img, 800, 600);
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
    await act(async () => {
      img.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 40, clientY: 20 }),
      );
    });
    expect(pickAtSpy).not.toHaveBeenCalled();
    expect(inputSpy).toHaveBeenCalled();
    const events = inputSpy.mock.calls[0]?.[0];
    expect(events?.[0]).toMatchObject({ type: 'mouse', action: 'down', x: 40, y: 20 });
  });

  it('Take over sends browser/lock owner user', async () => {
    const client = createMockHostClient();
    const lockSpy = vi.spyOn(client, 'browserLock');
    renderPanel({ hostClient: client });
    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({ type: 'browser/controller', owner: 'agent', agentWantsLock: true, ts: Date.now() });
      }
    });
    const button = queryByTestId('browser-session-take-over') as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(lockSpy).toHaveBeenCalledWith('user');
  });

  it('shows Give back whenever the user owns the page, even without an agent claim', async () => {
    const client = createMockHostClient();
    const unlockSpy = vi.spyOn(client, 'browserUnlock');
    renderPanel({ hostClient: client });
    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({ type: 'browser/controller', owner: 'user', ts: Date.now() });
      }
    });
    const button = queryByTestId('browser-session-give-back') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.textContent).toBe('释放');
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(unlockSpy).toHaveBeenCalledWith('user');
  });

  it('labels Give back when a run still wants the lock', () => {
    const client = createMockHostClient();
    renderPanel({ hostClient: client });
    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({
          type: 'browser/controller',
          owner: 'user',
          agentWantsLock: true,
          ts: Date.now(),
        });
      }
    });
    expect(queryByTestId('browser-session-give-back')?.textContent).toBe('交还');
  });

  function emitHostPush(client: HostClient, message: HostPush): void {
    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener(message);
      }
    });
  }

  function stubFrameClickTarget(img: HTMLImageElement): void {
    stubImgMetrics(img, 800, 600);
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
  }

  it('disables pointer, IME, and pick while the runtime is recovering', async () => {
    const client = createMockHostClient();
    const inputSpy = vi.spyOn(client, 'browserInput');
    const pickAtSpy = vi.spyOn(client, 'browserPickAt');
    renderPanel({ hostClient: client });
    emitHostPush(client, {
      type: 'browser/frame',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 800,
      height: 600,
      ts: Date.now(),
    });
    emitHostPush(client, {
      type: 'browser/state',
      lifecycle: 'recovering',
      mirror: 'off',
      generation: 1,
      pageId: 'page-1',
      ts: Date.now(),
    });

    const banner = queryByTestId('browser-session-runtime-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('正在恢复');
    expect(queryByTestId('browser-session-restart')).not.toBeNull();
    expect((queryByTestId('browser-session-pick-toggle') as HTMLButtonElement).disabled).toBe(true);
    expect((queryByTestId('browser-session-url-input') as HTMLInputElement).disabled).toBe(true);
    expect((queryByTestId('browser-session-go-btn') as HTMLButtonElement).disabled).toBe(true);
    expect(queryByTestId('browser-session-ime')).toBeNull();

    const img = queryByTestId('browser-session-frame') as HTMLImageElement;
    expect(img.classList.contains('stale')).toBe(true);
    stubFrameClickTarget(img);
    await act(async () => {
      img.dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 20,
        }),
      );
    });
    expect(inputSpy).not.toHaveBeenCalled();
    expect(pickAtSpy).not.toHaveBeenCalled();
  });

  it('Restart calls hostClient.browserRestart', async () => {
    const client = createMockHostClient();
    const restartSpy = vi.spyOn(client, 'browserRestart');
    renderPanel({ hostClient: client });
    emitHostPush(client, {
      type: 'browser/state',
      lifecycle: 'failed',
      mirror: 'off',
      generation: 1,
      ts: Date.now(),
    });
    const button = queryByTestId('browser-session-restart') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(restartSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the mirror error when Host reports ready streaming', async () => {
    const client = createMockHostClient();
    vi.spyOn(client, 'browserStart').mockRejectedValue(new Error('nope'));
    renderPanel({ hostClient: client });
    await act(async () => {
      await Promise.resolve();
    });
    expect(queryByTestId('browser-session-mirror-error')).not.toBeNull();
    expect(queryByTestId('browser-session-runtime-banner')).not.toBeNull();

    emitHostPush(client, {
      type: 'browser/state',
      lifecycle: 'ready',
      mirror: 'streaming',
      generation: 1,
      ts: Date.now(),
    });
    expect(queryByTestId('browser-session-mirror-error')).toBeNull();
    expect(queryByTestId('browser-session-runtime-banner')).toBeNull();
  });
});
