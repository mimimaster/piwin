import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureRendererRecovery,
  evaluateRendererRecoveryChecks,
  persistedDraftStateReader,
  requestRendererRecovery,
} from './renderer-recovery.js';
import type { ComposerReclaimInput } from '../composer/composer-draft-reclaim.js';
import { composerDraftPersistenceKey } from '../composer/composer-draft-persistence.js';

const EMPTY_INPUT: ComposerReclaimInput = {
  drafts: [],
  draftSnapshots: new Map(),
  sessionSnapshots: new Map(),
};

afterEach(() => {
  configureRendererRecovery({});
});

describe('evaluateRendererRecoveryChecks', () => {
  it('marks active Host runs as safe-to-continue before checking drafts', () => {
    const checks = evaluateRendererRecoveryChecks({ isRunActive: () => true });
    expect(checks).toEqual([
      { id: 'run-active', ok: true, reason: 'run-active-safe' },
      { id: 'draft-state', ok: false, reason: 'draft-state-unavailable' },
    ]);
  });

  it('fails closed when no draft state source is configured', () => {
    const checks = evaluateRendererRecoveryChecks({});
    expect(checks[0]).toEqual({ id: 'run-active', ok: true });
    expect(checks[1]).toEqual({ id: 'draft-state', ok: false, reason: 'draft-state-unavailable' });
  });

  it('reports the durability check for a supplied draft input', () => {
    const checks = evaluateRendererRecoveryChecks({ getDraftState: () => EMPTY_INPUT });
    expect(checks.map((check) => check.ok)).toEqual([true, true, true]);
  });
});

describe('requestRendererRecovery', () => {
  it('allows reload during an active Host run once drafts are durable', () => {
    const dispatch = vi.fn(() => true);
    const relaunch = vi.fn();
    const result = requestRendererRecovery({
      isRunActive: () => true,
      getDraftState: () => EMPTY_INPUT,
      dispatchRelaunchEvent: dispatch,
      relaunch,
    });
    expect(result.allowed).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it('still blocks during an active run when draft durability cannot be checked', () => {
    const dispatch = vi.fn(() => true);
    const relaunch = vi.fn();
    const result = requestRendererRecovery({
      isRunActive: () => true,
      dispatchRelaunchEvent: dispatch,
      relaunch,
    });
    expect(result).toMatchObject({ allowed: false, reason: 'draft-state-unavailable' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('fails closed with draft-state-unavailable when drafts cannot be read', () => {
    const dispatch = vi.fn(() => true);
    const result = requestRendererRecovery({
      isRunActive: () => false,
      dispatchRelaunchEvent: dispatch,
      relaunch: vi.fn(),
    });
    expect(result).toMatchObject({ allowed: false, reason: 'draft-state-unavailable' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('blocks when live drafts would not survive persistence', () => {
    // A draft snapshot with non-empty text that is not part of the draft list
    // cannot round-trip through the bounded store → not durable.
    const input: ComposerReclaimInput = {
      drafts: [],
      draftSnapshots: new Map([['ghost', { text: 'unsaved', attachments: [], contextRefs: [] }]]),
      sessionSnapshots: new Map(),
    };
    const result = requestRendererRecovery({
      getDraftState: () => input,
      dispatchRelaunchEvent: vi.fn(() => true),
      relaunch: vi.fn(),
    });
    expect(result).toMatchObject({ allowed: false, reason: 'drafts-not-durable' });
  });

  it('dispatches and relaunches when every check passes', () => {
    const dispatch = vi.fn(() => true);
    const relaunch = vi.fn();
    const result = requestRendererRecovery({
      getDraftState: () => EMPTY_INPUT,
      isRunActive: () => false,
      dispatchRelaunchEvent: dispatch,
      relaunch,
    });
    expect(result.allowed).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  it('reports cancelled-by-handler when a listener vetoes the relaunch event', () => {
    const relaunch = vi.fn();
    const result = requestRendererRecovery({
      getDraftState: () => EMPTY_INPUT,
      dispatchRelaunchEvent: () => false,
      relaunch,
    });
    expect(result).toMatchObject({ allowed: false, reason: 'cancelled-by-handler' });
    expect(relaunch).not.toHaveBeenCalled();
    expect(result.checks.at(-1)).toEqual({
      id: 'relaunch-veto',
      ok: false,
      reason: 'cancelled-by-handler',
    });
  });

  it('uses configured production deps merged under per-call overrides', () => {
    configureRendererRecovery({
      getDraftState: () => EMPTY_INPUT,
      isRunActive: () => false,
    });
    const relaunch = vi.fn();
    const result = requestRendererRecovery({
      dispatchRelaunchEvent: () => true,
      relaunch,
    });
    expect(result.allowed).toBe(true);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it('invokes native recycle_webview_process inside desktop Tauri and falls back to reload on error', async () => {
    const reload = vi.fn();
    const invoke = vi.fn().mockRejectedValueOnce(new Error('ipc failed')).mockResolvedValueOnce(undefined);
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }));
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {},
      navigator: { userAgent: 'Macintosh', maxTouchPoints: 0 },
      location: { reload },
    });
    try {
      const failedResult = requestRendererRecovery({
        getDraftState: () => EMPTY_INPUT,
        isRunActive: () => false,
        dispatchRelaunchEvent: () => true,
      });
      expect(failedResult.allowed).toBe(true);
      await vi.waitFor(() => {
        expect(invoke).toHaveBeenNthCalledWith(1, 'recycle_webview_process');
        expect(reload).toHaveBeenCalledTimes(1);
      });

      const okResult = requestRendererRecovery({
        getDraftState: () => EMPTY_INPUT,
        isRunActive: () => false,
        dispatchRelaunchEvent: () => true,
      });
      expect(okResult.allowed).toBe(true);
      await vi.waitFor(() => {
        expect(invoke).toHaveBeenNthCalledWith(2, 'recycle_webview_process');
      });
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock('@tauri-apps/api/core');
      vi.unstubAllGlobals();
    }
  });
});

describe('persistedDraftStateReader', () => {
  it('returns undefined for an unknown partition (fail closed)', () => {
    expect(persistedDraftStateReader(() => null)()).toBeUndefined();
  });

  it('rechecks a Host identity that becomes available after startup', () => {
    let partition: string | null = null;
    const readDrafts = persistedDraftStateReader(() => partition);
    expect(readDrafts()).toBeUndefined();

    partition = 'host-ready';
    expect(readDrafts()).toEqual(EMPTY_INPUT);

    partition = null;
    expect(readDrafts()).toBeUndefined();
  });

  it('reads the current Host partition after reconnecting', () => {
    const getItem = vi.fn(() => null);
    vi.stubGlobal('window', { localStorage: { getItem } });
    try {
      let partition = 'host-before-reconnect';
      const readDrafts = persistedDraftStateReader(() => partition);
      expect(readDrafts()).toEqual(EMPTY_INPUT);

      partition = 'host-after-reconnect';
      expect(readDrafts()).toEqual(EMPTY_INPUT);
      expect(getItem.mock.calls).toEqual([
        [composerDraftPersistenceKey('host-before-reconnect')],
        [composerDraftPersistenceKey('host-after-reconnect')],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
