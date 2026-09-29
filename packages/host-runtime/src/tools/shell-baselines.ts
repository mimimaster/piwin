/**
 * Workspace fingerprints taken only when sessions actually overlap.
 *
 * A shell that starts while another session is live in the same workspace
 * captures a fingerprint before it runs and publishes it here, stamped with
 * its grant tick. A shell that started alone and later saw company takes the
 * earliest fingerprint published after its own grant as its baseline: before
 * that moment nobody else was active, so any change up to it was its own.
 * A single session therefore pays nothing; the ~20ms `git status` is spent
 * only when overlap exists.
 *
 * Host file writes need no fingerprint — the activity log names their files.
 */
import type { WorkspaceWriteGate } from '../turn-changes/workspace-write-gate.js';
import type { WorkspaceFingerprint } from './workspace-fingerprint.js';

type PublishedBaseline = {
  tick: number;
  fingerprint: Promise<WorkspaceFingerprint | null>;
};

/** Enough for a burst of concurrent shells; older ones only serve finished runs. */
const MAX_BASELINES_PER_ROOT = 32;

const baselinesByGate = new WeakMap<WorkspaceWriteGate, Map<string, PublishedBaseline[]>>();

function rootBaselines(gate: WorkspaceWriteGate, root: string): PublishedBaseline[] {
  let byRoot = baselinesByGate.get(gate);
  if (!byRoot) {
    byRoot = new Map();
    baselinesByGate.set(gate, byRoot);
  }
  let list = byRoot.get(root);
  if (!list) {
    list = [];
    byRoot.set(root, list);
  }
  return list;
}

export function publishShellBaseline(
  gate: WorkspaceWriteGate,
  root: string,
  tick: number,
  fingerprint: Promise<WorkspaceFingerprint | null>,
): void {
  const list = rootBaselines(gate, root);
  list.push({ tick, fingerprint });
  list.sort((left, right) => left.tick - right.tick);
  if (list.length > MAX_BASELINES_PER_ROOT) {
    list.splice(0, list.length - MAX_BASELINES_PER_ROOT);
  }
}

/** Earliest baseline published at or after `tick`, if any. */
export function findShellBaselineSince(
  gate: WorkspaceWriteGate,
  root: string,
  tick: number,
): Promise<WorkspaceFingerprint | null> | undefined {
  return rootBaselines(gate, root).find((entry) => entry.tick >= tick)?.fingerprint;
}
