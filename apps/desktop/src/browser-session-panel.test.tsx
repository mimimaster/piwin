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
import type { BrowserFramePush, HostPush, HostResponse, WebElementPickResult } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { HostClient } from './host-client';
import { BrowserSessionPanel } from './browser-session-panel';
import { BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS } from './hooks/use-browser-viewport';
import { loadBrowserViewportPreference, saveBrowserViewportPreference } from './ui-preferences';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createMockHostClient(): HostClient {
  return new HostClient({ transport: 'mock' });
}


function browserFramePush(overrides: Partial<BrowserFramePush> = {}): BrowserFramePush {
  return {
    type: 'browser/frame',
    frameId: '1',
    width: 800,
    height: 600,
    encodedWidth: 800,
    encodedHeight: 600,
    sourceDpr: 1,
    quality: 80,
    producer: 'screencast',
    byteLength: 4,
    generation: 1,
    pageId: 'page-1',
    documentRevision: 0,
    payload: { kind: 'inline', dataUrl: 'data:image/jpeg;base64,/9j/4AAQ' },
    ts: 1,
    ...overrides,
  };
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
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
    panelActions?: { expanded: boolean; onToggleExpand: () => void; onClose: () => void };
  }): void {
    const tree: ReactElement = (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <BrowserSessionPanel
          hostClient={props.hostClient}
          onAddWebElement={props.onAddWebElement ?? vi.fn()}
          panelActions={props.panelActions}
        />
      </PiwinUiProvider>
    );
    act(() => {
      root.render(tree);
    });
  }

  function stubImgMetrics(img: HTMLImageElement, width: number, height: number): void {
    Object.defineProperty(img, 'clientWidth', { value: width, configurable: true });
    Object.defineProperty(img, 'clientHeight', { value: height, configurable: true });
  }

  /** The frame container is the page viewport the follow controller measures. */
  function stubFrameContainerBox(size: { width: number; height: number }): void {
    const box = {
      width: size.width,
      height: size.height,
      top: 0,
      left: 0,
      right: size.width,
      bottom: size.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    // spyOn (not defineProperty) so other tests can still stub element boxes
    // and so afterEach restores the original measurement.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(box);
  }


  /** Radix DropdownMenu triggers open on pointerdown, items select on click. */
  async function openRadixMenu(testId: string): Promise<void> {
    const trigger = queryByTestId(testId) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      trigger?.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      trigger?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  async function selectMenuItem(item: HTMLElement): Promise<void> {
    await act(async () => {
      item.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, cancelable: true }));
      item.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      item.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      nativeInputValueSetter?.call(input, value);
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  }

  function pressMenuItem(item: HTMLElement | null): Promise<void> {
    if (!item) throw new Error('menu item missing');
    return selectMenuItem(item);
  }

  function queryByTestId(testId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  }

  it('renders the panel with a URL bar and placeholder before the first frame', () => {
    const client = createMockHostClient();
    renderPanel({ hostClient: client });

    expect(queryByTestId('browser-session-panel')).not.toBeNull();
    expect(queryByTestId('browser-session-url-input')).not.toBeNull();
    // Icon-only chrome (spec §4.2): Enter submits, no permanent Go/Reload text.
    expect(queryByTestId('browser-session-go-btn')).toBeNull();
    expect(queryByTestId('browser-session-reload')).not.toBeNull();
    expect(queryByTestId('browser-session-open-external')).not.toBeNull();
    expect(queryByTestId('browser-session-pick-toggle')).not.toBeNull();
    expect(queryByTestId('browser-session-viewport-menu-btn')).not.toBeNull();
    // No frame yet → placeholder is shown, not the <img>.
    expect(queryByTestId('browser-session-frame')).toBeNull();
  });

  it('exposes history controls', async () => {
    const client = createMockHostClient();
    const requestSpy = vi.spyOn(client, 'request');
    renderPanel({ hostClient: client });
    expect(queryByTestId('browser-session-back')).not.toBeNull();
    expect(queryByTestId('browser-session-forward')).not.toBeNull();
    await act(async () => {
      queryByTestId('browser-session-back')?.click();
    });
    expect(requestSpy).toHaveBeenCalledWith({ type: 'browser/back' });
  });

  it('follow mode resizes the Host viewport from the panel box after the debounce', async () => {
    vi.useFakeTimers();
    const client = createMockHostClient();
    const resizeSpy = vi.spyOn(client, 'browserResize');
    stubFrameContainerBox({ width: 1024.4, height: 700.6 });
    renderPanel({ hostClient: client });
    expect(resizeSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS + 10);
    });
    expect(resizeSpy).toHaveBeenCalledTimes(1);
    expect(resizeSpy).toHaveBeenCalledWith(
      1024,
      701,
      expect.objectContaining({ mode: 'follow', origin: 'follow' }),
    );
  });

  it('fixed mode never sends follow resizes', async () => {
    vi.useFakeTimers();
    saveBrowserViewportPreference({ mode: 'fixed', width: 1280, height: 800 });
    const client = createMockHostClient();
    const resizeSpy = vi.spyOn(client, 'browserResize');
    stubFrameContainerBox({ width: 1024, height: 700 });
    renderPanel({ hostClient: client });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS + 10);
    });
    expect(resizeSpy).not.toHaveBeenCalled();
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
    // Ownership lives in the mode group now; pending dialogs and recovery keep
    // their own banners (spec §4.2).
    expect(queryByTestId('browser-session-agent-banner')).toBeNull();
    const control = queryByTestId('browser-session-control');
    expect(control?.getAttribute('data-owner')).toBe('agent');
    expect(control?.getAttribute('title')).toContain('接管');
    expect((queryByTestId('browser-session-url-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('forwards scaled coordinates on pick-mode click and calls onAddWebElement on browser/picked', async () => {
    const client = createMockHostClient();
    const pickAtSpy = vi.spyOn(client, 'browserPickAt');
    const onAddWebElement = vi.fn();
    renderPanel({ hostClient: client, onAddWebElement });

    // Push a synthetic frame so the <img> renders.
    await emitHostPush(client, browserFramePush({ width: 800, height: 600, ts: Date.now() }));

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

    await emitHostPush(client, browserFramePush({ width: 800, height: 600, ts: Date.now() }));

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

    await emitHostPush(client, browserFramePush({ width: 800, height: 600, ts: Date.now() }));

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

    await emitHostPush(client, browserFramePush({ width: 800, height: 600, ts: Date.now() }));

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

    await emitHostPush(client, browserFramePush({ width: 800, height: 600, ts: Date.now() }));

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
    await emitHostPush(client, browserFramePush({ width: 800, height: 600, ts: Date.now() }));
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

  it('clicking the control dot while the agent owns the page takes over', async () => {
    const client = createMockHostClient();
    const lockSpy = vi.spyOn(client, 'browserLock');
    renderPanel({ hostClient: client });
    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({ type: 'browser/controller', owner: 'agent', agentWantsLock: true, ts: Date.now() });
      }
    });
    const button = queryByTestId('browser-session-control') as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(lockSpy).toHaveBeenCalledWith('user');
  });

  it('clicking the control dot while the user owns the page gives it back', async () => {
    const client = createMockHostClient();
    const unlockSpy = vi.spyOn(client, 'browserUnlock');
    renderPanel({ hostClient: client });
    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({ type: 'browser/controller', owner: 'user', ts: Date.now() });
      }
    });
    const button = queryByTestId('browser-session-control') as HTMLButtonElement;
    expect(button.getAttribute('data-owner')).toBe('user');
    expect(button.getAttribute('title')).toContain('交还');
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(unlockSpy).toHaveBeenCalledWith('user');
  });

  it('disables the control dot while nobody controls the page', () => {
    const client = createMockHostClient();
    renderPanel({ hostClient: client });
    const button = queryByTestId('browser-session-control') as HTMLButtonElement;
    expect(button.getAttribute('data-owner')).toBe('idle');
    expect(button.disabled).toBe(true);
  });

  it('applies a viewport preset explicitly and persists it', async () => {
    const client = createMockHostClient();
    const resizeSpy = vi.spyOn(client, 'browserResize');
    renderPanel({ hostClient: client });
    await openRadixMenu('browser-session-viewport-menu-btn');
    await pressMenuItem(
      document.querySelector<HTMLElement>('[data-testid="browser-session-viewport-desktop"]'),
    );
    expect(resizeSpy).toHaveBeenCalledWith(
      1280,
      800,
      expect.objectContaining({ mode: 'fixed', origin: 'explicit' }),
    );
    expect(loadBrowserViewportPreference()).toEqual({ mode: 'fixed', width: 1280, height: 800, displayZoom: 'fit' });
  });

  it('leaves Responsive to the follow controller instead of sending a preset size', async () => {
    saveBrowserViewportPreference({ mode: 'fixed', width: 1280, height: 800 });
    const client = createMockHostClient();
    const resizeSpy = vi.spyOn(client, 'browserResize');
    renderPanel({ hostClient: client });
    await openRadixMenu('browser-session-viewport-menu-btn');
    await pressMenuItem(
      document.querySelector<HTMLElement>('[data-testid="browser-session-viewport-responsive"]'),
    );
    expect(resizeSpy).not.toHaveBeenCalled();
    expect(loadBrowserViewportPreference().mode).toBe('follow');
  });

  it('reload refreshes the committed page without reading the address draft', async () => {
    const client = createMockHostClient();
    const reloadSpy = vi.spyOn(client, 'browserReload');
    const navigateSpy = vi.spyOn(client, 'browserNavigate');
    renderPanel({ hostClient: client });
    await typeInto(queryByTestId('browser-session-url-input') as HTMLInputElement, 'example.com');
    await act(async () => {
      (queryByTestId('browser-session-reload') as HTMLButtonElement).click();
    });
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('toggles the developer drawer from the chrome', async () => {
    const client = createMockHostClient();
    renderPanel({ hostClient: client });
    expect(queryByTestId('browser-session-dev-body')).toBeNull();
    await act(async () => {
      (queryByTestId('browser-session-dev-drawer') as HTMLButtonElement).click();
    });
    expect(queryByTestId('browser-session-dev-body')).not.toBeNull();
  });

  it('collapses repeated command failures into one bounded, dismissible notice', async () => {
    const client = createMockHostClient();
    vi.spyOn(client, 'browserReload').mockResolvedValue({
      id: 'reload',
      type: 'response',
      command: 'browser/reload',
      success: false,
      error: 'nope',
    } as HostResponse);
    renderPanel({ hostClient: client });
    const reload = queryByTestId('browser-session-reload') as HTMLButtonElement;
    await act(async () => {
      reload.click();
    });
    expect(queryByTestId('browser-session-notice')?.textContent).toContain('浏览器命令失败');
    await act(async () => {
      reload.click();
    });
    expect(queryByTestId('browser-session-notice')?.textContent).toContain('重复 2 次');
    await act(async () => {
      (queryByTestId('browser-session-notice-dismiss') as HTMLButtonElement).click();
    });
    expect(queryByTestId('browser-session-notice')).toBeNull();
  });

  it('flags a low-density mirror from the real encoded size', async () => {
    const client = createMockHostClient();
    renderPanel({ hostClient: client });
    const framePush: HostPush = browserFramePush({
      width: 1600,
      height: 900,
      encodedWidth: 800,
      encodedHeight: 450,
      producer: 'screencast',
      ts: Date.now(),
    });
    await emitHostPush(client, framePush);
    const img = queryByTestId('browser-session-frame') as HTMLImageElement;
    stubImgMetrics(img, 1600, 900);
    await emitHostPush(client, framePush);
    expect(queryByTestId('browser-session-density-dot')).not.toBeNull();

    await emitHostPush(client, { ...framePush, frameId: '2', encodedWidth: 3400, encodedHeight: 1900 });
    expect(queryByTestId('browser-session-density-dot')).toBeNull();
  });

  it('renders panel-level actions only when the hosting surface provides them', async () => {
    const client = createMockHostClient();
    const onClose = vi.fn();
    const onToggleExpand = vi.fn();
    renderPanel({ hostClient: client });
    expect(queryByTestId('browser-session-close-panel')).toBeNull();
    expect(queryByTestId('browser-session-expand')).toBeNull();

    renderPanel({
      hostClient: client,
      panelActions: { expanded: false, onToggleExpand, onClose },
    });
    await act(async () => {
      (queryByTestId('browser-session-expand') as HTMLButtonElement).click();
      (queryByTestId('browser-session-close-panel') as HTMLButtonElement).click();
    });
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the Agent-set viewport note from Host state', async () => {
    const client = createMockHostClient();
    renderPanel({ hostClient: client });
    await emitHostPush(client, {
      type: 'browser/state',
      ts: Date.now(),
      viewport: { mode: 'fixed', width: 1280, height: 800, setBy: 'agent' },
    });
    expect(queryByTestId('browser-session-viewport-set-by')?.textContent).toBe('由 Agent 设置');
  });

  it('switches fixed-mode display to 100% without sending a resize', async () => {
    saveBrowserViewportPreference({ mode: 'fixed', width: 1280, height: 800 });
    const client = createMockHostClient();
    const resizeSpy = vi.spyOn(client, 'browserResize');
    renderPanel({ hostClient: client });
    await openRadixMenu('browser-session-viewport-menu-btn');
    await pressMenuItem(
      document.querySelector<HTMLElement>('[data-testid="browser-session-viewport-100"]'),
    );
    expect(resizeSpy).not.toHaveBeenCalled();
    expect(loadBrowserViewportPreference().displayZoom).toBe('100');
    expect(queryByTestId('browser-session-frame-container')?.getAttribute('data-zoom')).toBe('100');
  });

  it('lists mirror diagnostics in the developer drawer', async () => {
    const client = createMockHostClient();
    renderPanel({ hostClient: client });
    await emitHostPush(client, browserFramePush({
      width: 1280,
      height: 800,
      encodedWidth: 2560,
      encodedHeight: 1600,
      sourceDpr: 2,
      quality: 80,
      producer: 'screencast',
      ts: Date.now(),
    }));
    await act(async () => {
      (queryByTestId('browser-session-dev-drawer') as HTMLButtonElement).click();
    });
    const metrics = queryByTestId('browser-session-dev-metrics')?.textContent ?? '';
    expect(metrics).toContain('CSS 视口');
    expect(metrics).toContain('1280x800');
    expect(metrics).toContain('2560x1600');
    expect(metrics).toContain('screencast');
  });

  async function flushDecoder(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function emitHostPush(client: HostClient, message: HostPush): Promise<void> {
    const listeners = (client as unknown as { listeners: Set<(m: unknown) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener(message);
      }
    });
    await flushDecoder();
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
    await emitHostPush(client, browserFramePush({ width: 800, height: 600, ts: Date.now() }));
    await emitHostPush(client, {
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
    expect((queryByTestId('browser-session-reload') as HTMLButtonElement).disabled).toBe(true);
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
    await emitHostPush(client, {
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

    await emitHostPush(client, {
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
