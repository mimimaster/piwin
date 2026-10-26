import { describe, expect, it, vi } from 'vitest';
import {
  runScreenCapture,
  screenshotFileName,
  type ScreenCaptureFlowDeps,
} from './screen-capture-flow.js';
import type {
  DesktopScreenCaptureOs,
  ScreenCaptureAuthorization,
  ScreenCaptureOutcome,
} from './screen-capture-os.js';

function fakeOs(overrides: {
  supported?: boolean;
  authorization?: ScreenCaptureAuthorization;
  outcome?: ScreenCaptureOutcome;
}): DesktopScreenCaptureOs {
  return {
    capabilities: vi.fn(async () => ({
      supported: overrides.supported ?? true,
      systemRegionPicker: true,
    })),
    authorizationStatus: vi.fn(async () => overrides.authorization ?? 'authorized'),
    requestAuthorization: vi.fn(async () => 'authorized' as const),
    openSystemSettings: vi.fn(async () => undefined),
    restartApp: vi.fn(async () => undefined),
    take: vi.fn(
      async () =>
        overrides.outcome ?? {
          status: 'captured' as const,
          id: 'capture-1',
          width: 20,
          height: 10,
          byteLength: 3,
        },
    ),
    read: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
}

function deps(
  os: DesktopScreenCaptureOs,
  extra: Partial<ScreenCaptureFlowDeps> = {},
): ScreenCaptureFlowDeps {
  return { os, canAttach: () => true, imageRefusal: () => undefined, ...extra };
}

describe('runScreenCapture (SC-T05)', () => {
  it('returns the captured bytes and dimensions', async () => {
    const os = fakeOs({});
    await expect(runScreenCapture(deps(os))).resolves.toEqual({
      kind: 'captured',
      bytes: new Uint8Array([1, 2, 3]),
      width: 20,
      height: 10,
      systemRegionPicker: true,
    });
    expect(os.read).toHaveBeenCalledWith('capture-1');
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

  it('stops before the OS when attachments are blocked or images refused', async () => {
    const os = fakeOs({});
    await expect(runScreenCapture(deps(os, { canAttach: () => false }))).resolves.toEqual({
      kind: 'blocked',
    });
    await expect(
      runScreenCapture(deps(os, { imageRefusal: () => 'model has no vision' })),
    ).resolves.toEqual({ kind: 'refused', reason: 'model has no vision' });
    expect(os.capabilities).not.toHaveBeenCalled();
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
