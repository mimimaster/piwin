/**
 * S07 renderer-recovery action: the "Restart the workbench view" button.
 *
 * `prepareRendererRelaunch()` dispatches a synchronous, cancelable event —
 * handlers (composer drafts, note editor, speech input, …) veto or flush
 * inside it, so the dispatch itself remains the authoritative last gate.
 * But it is NOT a durability report: a veto means "refused", not "checked".
 * This module therefore runs explicit checks FIRST so the diagnostics panel
 * can explain why a restart is unavailable, then dispatches, then (on an
 * unvetoed dispatch) reloads the renderer.
 *
 * Draft durability is checked with `canReclaimComposerDrafts` over a
 * `ComposerReclaimInput` supplied by an injected `getDraftState`. When no
 * draft-state source is configured the check FAILS CLOSED
 * ('draft-state-unavailable') — restarting without knowing whether drafts
 * survive is exactly the data-loss path this action exists to prevent.
 *
 * Production wiring (`configureRendererRecovery` from workbench-app) uses
 * the persisted draft store as the draft-state source: it is what a
 * renderer restart would actually restore, and the composer veto inside
 * `prepareRendererRelaunch` remains the live-state gate at dispatch time.
 * Unknown partition (no persistence) reads as 'draft-state-unavailable'.
 */
import { canReclaimComposerDrafts } from '../composer/composer-draft-reclaim.js';
import type { ComposerReclaimInput } from '../composer/composer-draft-reclaim.js';
import { draftsFromPersistedStore, loadComposerDraftStore } from '../composer/composer-draft-persistence.js';
import { prepareRendererRelaunch } from './renderer-relaunch-preparation.js';

/** One durability check, in evaluation order. */
export type RendererRecoveryCheck = {
  id: 'run-active' | 'draft-state' | 'draft-durability' | 'relaunch-veto';
  ok: boolean;
  /** Machine-readable reason when the check failed. */
  reason?: string;
};

export type RendererRecoveryResult = {
  allowed: boolean;
  reason?: string;
  checks: RendererRecoveryCheck[];
};

export type RendererRecoveryDeps = {
  /** Live composer draft state; undefined ⇒ the durability check fails closed. */
  getDraftState?: () => ComposerReclaimInput | undefined;
  /** True while a Run/admission is live; restart is blocked. */
  isRunActive?: () => boolean;
  /** Executes the actual restart; default reloads the renderer. */
  relaunch?: () => void;
  /** Dispatch hook (tests stub); default prepareRendererRelaunch. */
  dispatchRelaunchEvent?: () => boolean;
};

let configuredDeps: RendererRecoveryDeps = {};

/**
 * Install the production dep wiring. Called once from a clean composition
 * root (workbench-app); later calls replace the deps (re-mounts/tests).
 */
export function configureRendererRecovery(deps: RendererRecoveryDeps): void {
  configuredDeps = deps;
}

/** Draft-state reader backed by the persisted store for `partitionId`. */
export function persistedDraftStateReader(
  partitionId: string | null,
): () => ComposerReclaimInput | undefined {
  return () => {
    if (partitionId === null) {
      return undefined;
    }
    const store = loadComposerDraftStore(partitionId);
    if (store === null) {
      // Nothing persisted: no drafts would survive anyway, so the empty
      // input passes durability and the relaunch-event veto stays the gate.
      return { drafts: [], draftSnapshots: new Map(), sessionSnapshots: new Map() };
    }
    return draftsFromPersistedStore(store);
  };
}

function resolveDeps(deps?: RendererRecoveryDeps): RendererRecoveryDeps {
  return { ...configuredDeps, ...deps };
}

/**
 * Run the pre-dispatch checks without dispatching anything. The panel calls
 * this each refresh to explain why the restart button is enabled/disabled.
 */
export function evaluateRendererRecoveryChecks(
  deps?: RendererRecoveryDeps,
): RendererRecoveryCheck[] {
  const resolved = resolveDeps(deps);
  const checks: RendererRecoveryCheck[] = [];

  const runActive = resolved.isRunActive?.() === true;
  checks.push({ id: 'run-active', ok: !runActive, ...(runActive ? { reason: 'run-active' } : {}) });
  if (runActive) return checks;

  const draftState = resolved.getDraftState?.();
  if (draftState === undefined) {
    checks.push({ id: 'draft-state', ok: false, reason: 'draft-state-unavailable' });
    return checks;
  }
  checks.push({ id: 'draft-state', ok: true });

  const durable = canReclaimComposerDrafts(draftState);
  checks.push({
    id: 'draft-durability',
    ok: durable,
    ...(durable ? {} : { reason: 'drafts-not-durable' }),
  });
  return checks;
}

/**
 * The tested recovery action: check → dispatch → relaunch.
 * - A failed check returns `{allowed: false, reason}`; nothing is dispatched.
 * - A vetoed dispatch returns 'cancelled-by-handler'.
 * - An unvetoed dispatch runs `relaunch` (default `window.location.reload()`)
 *   and returns `{allowed: true}` — callers on the real path never resume.
 */
export function requestRendererRecovery(
  deps?: RendererRecoveryDeps,
): RendererRecoveryResult {
  const resolved = resolveDeps(deps);
  const checks = evaluateRendererRecoveryChecks(resolved);
  const failed = checks.find((check) => !check.ok);
  if (failed !== undefined) {
    return { allowed: false, reason: failed.reason ?? 'check-failed', checks };
  }
  const dispatch = resolved.dispatchRelaunchEvent ?? prepareRendererRelaunch;
  if (!dispatch()) {
    checks.push({ id: 'relaunch-veto', ok: false, reason: 'cancelled-by-handler' });
    return { allowed: false, reason: 'cancelled-by-handler', checks };
  }
  checks.push({ id: 'relaunch-veto', ok: true });
  const relaunch =
    resolved.relaunch ??
    (() => {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    });
  relaunch();
  return { allowed: true, checks };
}
