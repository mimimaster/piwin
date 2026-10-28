import { describe, expect, it, vi } from 'vitest';
import {
  runScreenCapture,
  screenCaptureNeedsAppInFront,
  screenshotFileName,
  type ScreenCaptureFlowDeps,
} from './screen-capture-flow.js';
import type {
  DesktopScreenCaptureOs,
  ScreenCaptureAuthorization,
  ScreenCaptureMode,
  ScreenCaptureOutcome,
} from './screen-capture-os.js';

function fakeOs(overrides: {
  supported?: boolean;
  mode?: ScreenCaptureMode;
  authorization?: ScreenCaptureAuthorization;
  outcome?: ScreenCaptureOutcome;
}): DesktopScreenCaptureOs {
  return {
    capabilities: vi.fn(async () => ({
      supported: overrides.supported ?? true,
      mode: overrides.mode ?? 'overlay',
    })),
    authorizationStatus: vi.fn(async () => overrides.authorization ?? 'authorized'),
    requestAuthorization: vi.fn(async () => 'authorized' as const),
    openSystemSettings: vi.fn(async () => undefined),
    restartApp: vi.fn(async () => undefined),
    revealApp: vi.fn(async () => undefined),
    onShortcut: vi.fn(async () => () => undefined),
    take: vi.fn(
      async () =>
        overrides.outcome ?? {
          status: 'captured' as const,
          id: 'capture-1',
          width: 20,
          height: 10,
          byteLength: 3,
          annotated: true,
          copied: true,
        },
    ),
    read: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
}

function deps(
  os: DesktopScreenCaptureOs,
  extra: Partial<ScreenCaptureFlowDeps> = {},
): ScreenCaptureFlowDeps {
  return {
    os,
    canAttach: () => true,
    imageRefusal: () => undefined,
    piwinInFront: () => true,
    ...extra,
  };
}

const CLIPBOARD_ONLY: ScreenCaptureOutcome = {
  status: 'captured',
  id: null,
  width: 20,
  height: 10,
  byteLength: 3,
  annotated: true,
  copied: true,
};

describe('runScreenCapture (SC-T05)', () => {
  it('attaches the annotated image when piwin was in front', async () => {
    const os = fakeOs({});
    await expect(runScreenCapture(deps(os))).resolves.toEqual({
      kind: 'attach',
      bytes: new Uint8Array([1, 2, 3]),
      copied: true,
    });
    expect(os.take).toHaveBeenCalledWith({ deliverToComposer: true });
    expect(os.read).toHaveBeenCalledWith('capture-1');
  });

  it('only copies when the capture started from another app', async () => {
    const os = fakeOs({ outcome: CLIPBOARD_ONLY });
    await expect(runScreenCapture(deps(os, { piwinInFront: () => false }))).resolves.toEqual({
      kind: 'copied',
    });
    expect(os.take).toHaveBeenCalledWith({ deliverToComposer: false });
    expect(os.read).not.toHaveBeenCalled();
  });

  it('reports a clipboard failure when nothing else got the image', async () => {
    const os = fakeOs({ outcome: { ...CLIPBOARD_ONLY, copied: false } });
    await expect(runScreenCapture(deps(os, { piwinInFront: () => false }))).resolves.toEqual({
      kind: 'copy-failed',
    });
  });

  it('never blocks an overlay capture on composer state, and checks it afterwards', async () => {
    const blocked = fakeOs({});
    await expect(runScreenCapture(deps(blocked, { canAttach: () => false }))).resolves.toEqual({
      kind: 'blocked',
      copied: true,
    });
    expect(blocked.take).toHaveBeenCalledOnce();
    expect(blocked.read).not.toHaveBeenCalled();
    const refused = fakeOs({});
    await expect(
      runScreenCapture(deps(refused, { imageRefusal: () => 'model has no vision' })),
    ).resolves.toEqual({ kind: 'refused', reason: 'model has no vision', copied: true });
  });

  it('opens the editor for an OS-picked region', async () => {
    const os = fakeOs({
      mode: 'system-picker',
      outcome: {
        status: 'captured',
        id: 'capture-1',
        width: 20,
        height: 10,
        byteLength: 3,
        annotated: false,
        copied: false,
      },
    });
    await expect(runScreenCapture(deps(os, { piwinInFront: () => false }))).resolves.toEqual({
      kind: 'edit',
      bytes: new Uint8Array([1, 2, 3]),
      width: 20,
      height: 10,
    });
    expect(os.take).toHaveBeenCalledWith({ deliverToComposer: true });
  });

  it('checks the composer before the OS picker opens', async () => {
    const os = fakeOs({ mode: 'system-picker' });
    await expect(runScreenCapture(deps(os, { canAttach: () => false }))).resolves.toEqual({
      kind: 'blocked',
      copied: false,
    });
    expect(os.take).not.toHaveBeenCalled();
  });

  it('does not read anything after a cancel', async () => {
    const os = fakeOs({ outcome: { status: 'cancelled' } });
    await expect(runScreenCapture(deps(os))).resolves.toEqual({ kind: 'cancelled' });
    expect(os.read).not.toHaveBeenCalled();
  });

  it('never takes a capture without the Screen Recording grant', async () => {
    const os = fakeOs({ authorization: 'not-determined-or-denied' });
    await expect(runScreenCapture(deps(os))).resolves.toEqual({ kind: 'needs-permission' });
    expect(os.take).not.toHaveBeenCalled();
  });

  it('reports unsupported platforms without asking for permission', async () => {
    const os = fakeOs({ supported: false });
    await expect(runScreenCapture(deps(os))).resolves.toEqual({ kind: 'unsupported' });
    expect(os.authorizationStatus).not.toHaveBeenCalled();
  });

  it('maps native failure codes', async () => {
    const cases: Array<[string, string]> = [
      ['SCREEN_CAPTURE_BUSY', 'busy'],
      ['SCREEN_CAPTURE_DENIED', 'needs-permission'],
      ['SCREEN_CAPTURE_UNSUPPORTED', 'unsupported'],
    ];
    for (const [code, kind] of cases) {
      const os = fakeOs({ outcome: { status: 'failed', code } });
      await expect(runScreenCapture(deps(os))).resolves.toEqual({ kind });
    }
    const os = fakeOs({ outcome: { status: 'failed', code: 'SCREEN_CAPTURE_FAILED' } });
    await expect(runScreenCapture(deps(os))).resolves.toEqual({
      kind: 'failed',
      code: 'SCREEN_CAPTURE_FAILED',
    });
  });
});

describe('screenshotFileName', () => {
  it('uses local date and time with zero padding', () => {
    expect(screenshotFileName(new Date(2026, 0, 5, 9, 3, 7))).toBe(
      'screenshot-20260105-090307.png',
    );
  });
});

describe('screenCaptureNeedsAppInFront', () => {
  it('brings piwin forward only when the user has something to read or answer', () => {
    expect(screenCaptureNeedsAppInFront({ kind: 'needs-permission' })).toBe(true);
    expect(
      screenCaptureNeedsAppInFront({ kind: 'refused', reason: 'no images', copied: true }),
    ).toBe(true);
    expect(screenCaptureNeedsAppInFront({ kind: 'blocked', copied: false })).toBe(true);
    expect(screenCaptureNeedsAppInFront({ kind: 'copy-failed' })).toBe(true);
    expect(screenCaptureNeedsAppInFront({ kind: 'copied' })).toBe(false);
    expect(screenCaptureNeedsAppInFront({ kind: 'failed', code: 'X' })).toBe(true);
    expect(screenCaptureNeedsAppInFront({ kind: 'cancelled' })).toBe(false);
    expect(screenCaptureNeedsAppInFront({ kind: 'busy' })).toBe(false);
  });
});
