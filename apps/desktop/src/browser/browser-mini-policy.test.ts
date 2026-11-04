import { describe, expect, it } from 'vitest';
import {
  BROWSER_MINI_INSET_PX,
  BROWSER_MINI_SIZE,
  browserMiniPlacementFromStored,
  browserMiniPlacementToStored,
  clampBrowserMiniPosition,
  defaultBrowserMiniPosition,
  hasBrowserMiniActivity,
  moveBrowserMini,
  resolveBrowserMiniRuntimeState,
  resolveBrowserMiniTitle,
  resolveBrowserMiniVisibility,
  shouldSnapBrowserMiniBack,
} from './browser-mini-policy';

const idle = { url: '', owner: 'idle' as const };
const live = { url: 'http://127.0.0.1:3000/login', owner: 'user' as const };

function visibility(overrides: Partial<Parameters<typeof resolveBrowserMiniVisibility>[0]>) {
  return resolveBrowserMiniVisibility({
    rightBodyOpen: false,
    overlayOpen: false,
    phone: false,
    dismissed: false,
    activity: live,
    ...overrides,
  });
}

describe('browser mini visibility', () => {
  it('shows a live page when the right workspace is collapsed', () => {
    expect(visibility({})).toEqual({ visible: true });
  });

  it('never competes with an expanded right workspace body', () => {
    expect(visibility({ rightBodyOpen: true })).toEqual({
      visible: false,
      reason: 'panel-open',
    });
  });

  it('stays hidden on phone, behind overlays, and after a manual dismiss', () => {
    expect(visibility({ phone: true })).toEqual({ visible: false, reason: 'phone' });
    expect(visibility({ overlayOpen: true })).toEqual({
      visible: false,
      reason: 'overlay',
    });
    expect(visibility({ dismissed: true })).toEqual({
      visible: false,
      reason: 'dismissed',
    });
  });

  it('needs a real page, not just a lease or a blank frame', () => {
    expect(visibility({ activity: idle })).toEqual({
      visible: false,
      reason: 'no-activity',
    });
    expect(
      visibility({ activity: { url: 'about:blank', owner: 'idle' } }),
    ).toEqual({ visible: false, reason: 'no-activity' });
    // A starting navigation counts: the agent is driving.
    expect(
      visibility({ activity: { url: '', owner: 'agent' } }),
    ).toEqual({ visible: true });
    expect(
      visibility({ activity: { url: 'https://example.com', owner: 'idle' } }),
    ).toEqual({ visible: true });
  });

  it('never treats an about:blank tab as activity', () => {
    expect(hasBrowserMiniActivity(live)).toBe(true);
    expect(hasBrowserMiniActivity(idle)).toBe(false);
    expect(hasBrowserMiniActivity({ url: 'about:blank', owner: 'idle' })).toBe(false);
    expect(hasBrowserMiniActivity({ url: ' about:blank ', owner: 'idle' })).toBe(false);
    // The agent keeps the mini while it launches its own page.
    expect(hasBrowserMiniActivity({ url: 'about:blank', owner: 'agent' })).toBe(true);
  });
});

describe('browser mini runtime state', () => {
  const healthy = {
    lifecycle: 'ready' as const,
    mirror: 'streaming' as const,
    mirrorError: null,
    frameError: null,
    hostReady: true,
    frameSrc: 'data:image/jpeg;base64,aa',
  };

  it('is live only with a frame, a ready runtime, and a live host', () => {
    expect(resolveBrowserMiniRuntimeState(healthy)).toBe('live');
  });

  it('reports a dropped socket instead of pretending the last frame is live', () => {
    expect(resolveBrowserMiniRuntimeState({ ...healthy, hostReady: false })).toBe('stale');
    expect(
      resolveBrowserMiniRuntimeState({ ...healthy, hostReady: false, frameSrc: '' }),
    ).toBe('reconnecting');
  });

  it('separates starting from a failed mirror', () => {
    expect(
      resolveBrowserMiniRuntimeState({ ...healthy, lifecycle: 'starting', frameSrc: '' }),
    ).toBe('starting');
    expect(resolveBrowserMiniRuntimeState({ ...healthy, mirror: 'degraded' })).toBe('stale');
    expect(
      resolveBrowserMiniRuntimeState({
        ...healthy,
        mirror: 'degraded',
        frameSrc: '',
      }),
    ).toBe('error');
  });
});

describe('browser mini geometry', () => {
  const container = { width: 900, height: 600 };

  it('defaults to the top-right inset corner', () => {
    expect(defaultBrowserMiniPosition({ container })).toEqual({
      x: container.width - BROWSER_MINI_SIZE.width - BROWSER_MINI_INSET_PX,
      y: BROWSER_MINI_INSET_PX,
    });
  });

  it('clamps a dragged window inside the stage', () => {
    expect(
      clampBrowserMiniPosition({ point: { x: -400, y: -80 }, container }),
    ).toEqual({ x: BROWSER_MINI_INSET_PX, y: BROWSER_MINI_INSET_PX });
    expect(clampBrowserMiniPosition({ point: { x: 5000, y: 5000 }, container })).toEqual({
      x: container.width - BROWSER_MINI_SIZE.width - BROWSER_MINI_INSET_PX,
      y: container.height - BROWSER_MINI_SIZE.height - BROWSER_MINI_INSET_PX,
    });
  });

  it('keeps the top-left corner usable in a container smaller than the card', () => {
    expect(
      clampBrowserMiniPosition({ point: { x: 40, y: 40 }, container: { width: 120, height: 90 } }),
    ).toEqual({ x: BROWSER_MINI_INSET_PX, y: BROWSER_MINI_INSET_PX });
  });

  it('moves by a delta and re-clamps', () => {
    const start = { x: 100, y: 100 };
    expect(moveBrowserMini({ point: start, delta: { dx: 16, dy: -16 }, container })).toEqual({
      x: 116,
      y: 84,
    });
    expect(moveBrowserMini({ point: start, delta: { dx: 10_000, dy: 0 }, container }).x).toBe(
      container.width - BROWSER_MINI_SIZE.width - BROWSER_MINI_INSET_PX,
    );
  });

  it('snaps back only near the docked anchor', () => {
    const anchor = defaultBrowserMiniPosition({ container });
    expect(shouldSnapBrowserMiniBack({ point: anchor, container })).toBe(true);
    expect(
      shouldSnapBrowserMiniBack({
        point: { x: anchor.x - 20, y: anchor.y + 20 },
        container,
      }),
    ).toBe(true);
    expect(
      shouldSnapBrowserMiniBack({
        point: { x: anchor.x - 200, y: anchor.y + 200 },
        container,
      }),
    ).toBe(false);
  });
});

describe('browser mini title', () => {
  it('prefers the page title, then the host, then the fallback', () => {
    expect(
      resolveBrowserMiniTitle({ title: 'Inbox', url: 'https://mail.example.com/a', fallback: 'x' }),
    ).toBe('Inbox');
    expect(
      resolveBrowserMiniTitle({ title: ' ', url: 'https://mail.example.com/a', fallback: 'x' }),
    ).toBe('mail.example.com');
    expect(resolveBrowserMiniTitle({ title: '', url: '', fallback: 'x' })).toBe('x');
  });
});

describe('persisted placement', () => {
  const container = { width: 1200, height: 800 };

  it('stores the corner as a share of the stage, not raw pixels', () => {
    expect(browserMiniPlacementToStored({ x: 600, y: 200 }, container)).toEqual({
      xRatio: 0.5,
      yRatio: 0.25,
    });
  });

  it('refuses a degenerate stage instead of storing NaN', () => {
    expect(browserMiniPlacementToStored({ x: 10, y: 10 }, { width: 0, height: 0 })).toBeNull();
  });

  it('restores into todays viewport and clamps an off-screen corner', () => {
    expect(browserMiniPlacementFromStored({ xRatio: 0.5, yRatio: 0.25 }, container)).toEqual({
      x: 600,
      y: 200,
    });
    // 0.99 of a narrow window still lands inside the inset box.
    const narrow = { width: 400, height: 500 };
    const restored = browserMiniPlacementFromStored({ xRatio: 0.99, yRatio: 0.99 }, narrow);
    expect(restored).not.toBeNull();
    expect(restored!.x).toBeLessThanOrEqual(narrow.width - BROWSER_MINI_SIZE.width - 12);
    expect(restored!.y).toBeLessThanOrEqual(narrow.height - BROWSER_MINI_SIZE.height - 12);
  });

  it('ignores garbage from storage', () => {
    expect(browserMiniPlacementFromStored(null, container)).toBeNull();
    expect(browserMiniPlacementFromStored('corner', container)).toBeNull();
    expect(browserMiniPlacementFromStored({ xRatio: 2, yRatio: 0.1 }, container)).toBeNull();
    expect(browserMiniPlacementFromStored({ xRatio: Number.NaN, yRatio: 0.1 }, container)).toBeNull();
  });
});
