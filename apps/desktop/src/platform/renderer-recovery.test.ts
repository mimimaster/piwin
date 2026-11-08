import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureRendererRecovery,
  evaluateRendererRecoveryChecks,
  persistedDraftStateReader,
  requestRendererRecovery,
} from './renderer-recovery.js';
import type { ComposerReclaimInput } from '../composer/composer-draft-reclaim.js';

const EMPTY_INPUT: ComposerReclaimInput = {
  drafts: [],
  draftSnapshots: new Map(),
  sessionSnapshots: new Map(),
};

afterEach(() => {
  configureRendererRecovery({});
});

describe('evaluateRendererRecoveryChecks', () => {
  it('fails closed when a run is active, before checking drafts', () => {
    const checks = evaluateRendererRecoveryChecks({ isRunActive: () => true });
    expect(checks).toEqual([{ id: 'run-active', ok: false, reason: 'run-active' }]);
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
  it('blocks during a run and never dispatches', () => {
    const dispatch = vi.fn(() => true);
    const relaunch = vi.fn();
    const result = requestRendererRecovery({
      isRunActive: () => true,
      getDraftState: () => EMPTY_INPUT,
      dispatchRelaunchEvent: dispatch,
      relaunch,
    });
    expect(result).toMatchObject({ allowed: false, reason: 'run-active' });
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
});

describe('persistedDraftStateReader', () => {
  it('returns undefined for an unknown partition (fail closed)', () => {
    expect(persistedDraftStateReader(null)()).toBeUndefined();
  });
});
