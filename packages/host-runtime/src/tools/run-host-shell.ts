/**
 * Host `bash` / `run_bash` executor under the optimistic workspace policy.
 *
 * Listed repo-wide commands (see shell-write-policy) take the exclusive
 * lease as before. Everything else takes the shared shell lease: it runs
 * beside other sessions' file writes and shells, waiting only for exclusive
 * holders. Afterwards it asks the activity log whether another session was
 * active in the workspace during the run; if so, and something actually
 * changed, the result says which files moved so the model knows a test or
 * build may have seen a mix of versions.
 *
 * When the turn is being recorded for undo (`onShellAudit`), every command
 * is fingerprinted before and after and reports which tracked files it
 * changed — other sessions' Host writes in the window subtracted. Sealing
 * uses that to keep undo available for turns that only read or test.
 * Without a recorder, fingerprints are taken only while sessions overlap
 * (see shell-baselines).
 */
import { execFile } from 'node:child_process';
import { isAbsolute, relative } from 'node:path';
import { promisify } from 'node:util';

import type { JobController, ToolResult, WorkspaceWriteToolDetails } from '@piwin/contracts';
import type { TurnChangeWriteReceipt } from '@piwin/git';
import type { CommandChangeCapturer, CommandPreSnapshot } from '../turn-changes/command-capture.js';
import type { ShellAuditReport } from '../turn-changes/tool-capture.js';
import { runManagedBash } from './run-managed-bash.js';
import {
  runWithWorkspaceWriteGate,
  type HeldWorkspaceWrite,
  type WorkspaceWriteBinding,
} from './run-with-workspace-write-gate.js';
import { findShellBaselineSince, publishShellBaseline } from './shell-baselines.js';
import { resolveShellWriteLock } from './shell-write-policy.js';
import { resolveAgentShell } from './windows-bash-shell.js';
import {
  captureWorkspaceFingerprint,
  diffWorkspaceFingerprints,
  type WorkspaceFingerprint,
} from './workspace-fingerprint.js';

const execFileAsync = promisify(execFile);

const DEFAULT_SHELL_TIMEOUT_MS = 30_000;
/** Keep the model-facing note short; full lists stay in details. */
const MAX_NOTE_PATHS = 12;

export type RunHostShellInput = {
  command: string;
  timeoutMs?: number;
  cwd: string;
  signal: AbortSignal;
  runId: string;
  sessionId: string;
  piwinRoot?: string;
  jobController?: JobController;
  workspaceWrite?: WorkspaceWriteBinding;
  /** Turn recorder: receives what this command changed under `auditRoot`. */
  onShellAudit?: (audit: ShellAuditReport) => void;
  /** Root the audit fingerprints and reports paths against. */
  auditRoot?: string;
  /**
   * Images the files this command changed (see command-capture.ts). Without
   * it, or where it cannot image a file, that file is only reported by path.
   */
  commandCapture?: CommandChangeCapturer;
  /** Receives one receipt per file `commandCapture` imaged. */
  onReceipt?: (receipt: TurnChangeWriteReceipt) => void;
};

export async function runHostShell(input: RunHostShellInput): Promise<ToolResult> {
  const lock = resolveShellWriteLock(input.command);
  const optimistic = lock.mode === 'optimistic';
  return runWithWorkspaceWriteGate({
    workspaceWrite: input.workspaceWrite,
    runId: input.runId,
    ownerId: input.sessionId,
    signal: input.signal,
    mode: optimistic ? 'shared' : 'exclusive',
    kind: optimistic ? 'shell' : 'tool',
    wait: true,
    run: async (held) => {
      const auditRoot = input.onShellAudit ? input.auditRoot : undefined;
      let ownBaseline: WorkspaceFingerprint | null | undefined;
      let preSnapshot: CommandPreSnapshot | undefined;
      if (auditRoot !== undefined) {
        ownBaseline = await captureWorkspaceFingerprint(auditRoot);
        if (held && optimistic) {
          publishShellBaseline(held.gate, held.root, held.grantedAtTick, Promise.resolve(ownBaseline));
        }
        // A command that moves HEAD or the index (checkout, reset, stash…) does
        // not edit files as the turn's author: its file changes are not imaged,
        // so undo never replays them over a different branch.
        if (
          ownBaseline &&
          input.commandCapture &&
          !(lock.mode === 'exclusive' && lock.reason === 'git-worktree-state')
        ) {
          preSnapshot = await input.commandCapture.snapshotBefore({
            root: auditRoot,
            fingerprint: ownBaseline,
          });
        }
      } else if (optimistic && held) {
        ownBaseline = await captureBaselineIfOverlapping(held);
      }
      let result: ToolResult;
      try {
        result = await executeShell(input);
      } finally {
        if (auditRoot !== undefined && input.onShellAudit) {
          const after = ownBaseline ? await captureWorkspaceFingerprint(auditRoot) : null;
          const audit = auditCommand({
            held,
            auditRoot,
            changed: ownBaseline && after ? diffWorkspaceFingerprints(ownBaseline, after) : null,
          });
          input.onShellAudit(
            await imageChangedFiles({ audit, auditRoot, preSnapshot, input }),
          );
        }
      }
      return optimistic && held ? annotateConcurrentChanges(result, held, ownBaseline) : result;
    },
  });
}

async function executeShell(input: RunHostShellInput): Promise<ToolResult> {
  const timeout = input.timeoutMs ?? DEFAULT_SHELL_TIMEOUT_MS;
  if (input.jobController) {
    return runManagedBash({
      controller: input.jobController,
      command: input.command,
      cwd: input.cwd,
      timeoutMs: timeout,
      signal: input.signal,
      runId: input.runId,
      sessionId: input.sessionId,
      ...(input.piwinRoot ? { piwinRoot: input.piwinRoot } : {}),
    });
  }
  const invocation = resolveAgentShell(input.command, input.piwinRoot);
  const { stdout, stderr } = await execFileAsync(invocation.command, invocation.argv, {
    cwd: input.cwd,
    timeout,
    windowsHide: true,
    signal: input.signal,
    maxBuffer: 1024 * 1024,
  });
  return { ok: true, output: stdout + (stderr ? `\n[stderr]\n${stderr}` : '') };
}

/**
 * Turn the paths a command changed into before/after receipts where they can
 * be imaged; the audit that remains names only what could not be.
 */
async function imageChangedFiles(context: {
  audit: ShellAuditReport;
  auditRoot: string;
  preSnapshot: CommandPreSnapshot | undefined;
  input: RunHostShellInput;
}): Promise<ShellAuditReport> {
  const { audit, preSnapshot, input } = context;
  if (audit.status !== 'changed' || !preSnapshot || !input.commandCapture) {
    return audit;
  }
  const captured = await input.commandCapture.captureChanges({
    root: context.auditRoot,
    changedPaths: audit.paths,
    before: preSnapshot,
  });
  for (const receipt of captured.receipts) {
    input.onReceipt?.(receipt);
  }
  return captured.uncaptured.length === 0
    ? { status: 'clean' }
    : { status: 'changed', paths: captured.uncaptured };
}

/**
 * Which tracked files this command changed. Files other sessions wrote through
 * Host in the same window are theirs, not this command's. This session's own
 * parallel Host writes stay in: a command and a Host write touching the same
 * file in one turn must make that file's undo unsafe, not silently partial.
 */
function auditCommand(input: {
  held: HeldWorkspaceWrite | undefined;
  auditRoot: string;
  changed: string[] | null;
}): ShellAuditReport {
  if (input.changed === null) {
    return { status: 'unknown' };
  }
  let paths = input.changed;
  const held = input.held;
  if (held) {
    const others = held.gate.activity.othersSince({
      root: held.root,
      fromTick: held.grantedAtTick,
      ...(held.ownerId !== undefined ? { ownerId: held.ownerId } : {}),
    });
    const theirs = new Set(others.fileWrites.map((key) => toRootRelative(held.root, key)));
    paths = paths.filter((path) => !theirs.has(path));
  }
  return paths.length === 0 ? { status: 'clean' } : { status: 'changed', paths };
}

/**
 * Another session already live here: fingerprint before running, and publish
 * it so shells that started earlier (alone) get a baseline for this moment.
 * Awaited so the snapshot precedes this command's own first write.
 */
async function captureBaselineIfOverlapping(
  held: HeldWorkspaceWrite,
): Promise<WorkspaceFingerprint | null | undefined> {
  const live = held.gate.activity.othersSince({
    root: held.root,
    fromTick: held.gate.activity.now(),
    ...(held.ownerId !== undefined ? { ownerId: held.ownerId } : {}),
  });
  const overlapping = live.fileWrites.length > 0 || live.exclusiveCount > 0 || live.shellCount > 0;
  if (!overlapping) {
    return undefined;
  }
  const fingerprint = captureWorkspaceFingerprint(held.root);
  publishShellBaseline(held.gate, held.root, held.grantedAtTick, fingerprint);
  return fingerprint;
}

async function annotateConcurrentChanges(
  result: ToolResult,
  held: HeldWorkspaceWrite,
  ownBaseline: WorkspaceFingerprint | null | undefined,
): Promise<ToolResult> {
  const others = held.gate.activity.othersSince({
    root: held.root,
    fromTick: held.grantedAtTick,
    ...(held.ownerId !== undefined ? { ownerId: held.ownerId } : {}),
  });
  const anyOther =
    others.fileWrites.length > 0 || others.exclusiveCount > 0 || others.shellCount > 0;
  if (!anyOther) {
    return result;
  }
  // Started alone: the first overlapping shell's snapshot is this run's baseline.
  const before =
    ownBaseline !== undefined
      ? ownBaseline
      : ((await findShellBaselineSince(held.gate, held.root, held.grantedAtTick)) ?? null);
  const after = before === null ? null : await captureWorkspaceFingerprint(held.root);
  const changedDuringRun =
    before !== null && after !== null ? diffWorkspaceFingerprints(before, after) : [];
  const otherSessionWrites = others.fileWrites.map((key) => toRootRelative(held.root, key));
  // Another session only running commands is noise unless files really moved.
  if (otherSessionWrites.length === 0 && others.exclusiveCount === 0 && changedDuringRun.length === 0) {
    return result;
  }
  const concurrentChanges = { otherSessionWrites, changedDuringRun };
  const note = formatConcurrentChangeNote(concurrentChanges);
  const workspaceWrite: WorkspaceWriteToolDetails = {
    lock: 'shared',
    queuedMs: 0,
    concurrentChanges,
  };
  const details = { ...result.details, workspaceWrite };
  return result.ok
    ? { ...result, output: `${result.output}\n\n${note}`, details }
    : { ...result, message: `${result.message}\n\n${note}`, details };
}

export function formatConcurrentChangeNote(changes: {
  otherSessionWrites: readonly string[];
  changedDuringRun: readonly string[];
}): string {
  const lines = [
    '[workspace] Other sessions were active in this workspace while this command ran, so its result may not match the current files.',
  ];
  if (changes.otherSessionWrites.length > 0) {
    lines.push(`Written by other sessions: ${formatPathList(changes.otherSessionWrites)}`);
  }
  if (changes.changedDuringRun.length > 0) {
    lines.push(
      `Changed during the run (may include this command's own writes): ${formatPathList(changes.changedDuringRun)}`,
    );
  }
  lines.push('Re-run the command if you need a result for the current files.');
  return lines.join('\n');
}

function formatPathList(paths: readonly string[]): string {
  const shown = paths.slice(0, MAX_NOTE_PATHS).join(', ');
  const hidden = paths.length - MAX_NOTE_PATHS;
  return hidden > 0 ? `${shown} (+${hidden} more)` : shown;
}

function toRootRelative(root: string, key: string): string {
  const rel = relative(root, key);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? key : rel.split('\\').join('/');
}
