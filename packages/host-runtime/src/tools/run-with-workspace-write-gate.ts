/**
 * Acquire the workspace write gate around a Host filesystem/shell executor.
 * Permission admission happens before this helper; abort is rechecked after wait.
 *
 * Also the one place that measures gate queue time (reported separately from
 * execution time) and, for exact-path writes, refuses a write-after-write
 * when another session changed the file since this session last wrote it.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { resolveFileLockKey } from '@piwin/git';
import type { ToolResult, WorkspaceWriteToolDetails } from '@piwin/contracts';
import {
  judgeForeignFileChange,
  type ForeignFileChangeVerdict,
} from '../turn-changes/session-file-ledger.js';
import type {
  WorkspaceWriteAcquireInput,
  WorkspaceWriteGate,
} from '../turn-changes/workspace-write-gate.js';

/** Never equals a real hash, so the next whole-file write compares as drifted. */
const UNKNOWN_VERSION_SHA = 'unknown-version';

export type WorkspaceWriteBinding = {
  gate: WorkspaceWriteGate;
  workspaceId: string;
  rootPath: string;
};

/** What the tool body holds while it runs. */
export type HeldWorkspaceWrite = {
  gate: WorkspaceWriteGate;
  root: string;
  grantedAtTick: number;
  ownerId: string | undefined;
};

export async function runWithWorkspaceWriteGate(input: {
  workspaceWrite: WorkspaceWriteBinding | undefined;
  runId: string;
  /** Session that issued the call; other sessions' activity is judged against it. */
  ownerId?: string;
  signal: AbortSignal;
  mode: WorkspaceWriteAcquireInput['mode'];
  /** `shell` takes the shared lease without file keys. Default `tool`. */
  kind?: 'tool' | 'shell';
  wait: boolean;
  filePath?: string;
  /**
   * Whole-file writes refuse a write-after-write over another session's
   * change. `edit` opts out: it matches against the bytes on disk, so a change
   * elsewhere is kept and a change to its region already fails the match.
   */
  foreignChangeCheck?: boolean;
  run: (held: HeldWorkspaceWrite | undefined) => Promise<ToolResult>;
  /** Injectable clock for queue-time tests. */
  now?: () => number;
}): Promise<ToolResult> {
  if (!input.workspaceWrite) {
    return input.run(undefined);
  }
  if (input.signal.aborted) {
    return { ok: false, code: 'aborted', message: 'tool execution aborted' };
  }
  const now = input.now ?? Date.now;
  const kind = input.kind ?? 'tool';

  let paths: string[] | undefined;
  if (input.mode === 'shared' && kind === 'tool') {
    const filePath = input.filePath;
    if (!filePath) {
      throw new Error('shared workspace write requires filePath');
    }
    const resolved = await resolveFileLockKey(filePath);
    if (!resolved.ok) {
      return {
        ok: false,
        code: 'execution-failed',
        message: `invalid write path: ${resolved.reason}`,
      };
    }
    paths = [resolved.key];
  }

  const queuedAt = now();
  const acquired = await input.workspaceWrite.gate.tryAcquire({
    workspaceId: input.workspaceWrite.workspaceId,
    rootPath: input.workspaceWrite.rootPath,
    kind,
    mode: input.mode,
    wait: input.wait,
    runId: input.runId,
    ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
    signal: input.signal,
    ...(paths ? { paths } : {}),
  });
  if (!acquired.ok) {
    if (acquired.reason === 'aborted') {
      return { ok: false, code: 'aborted', message: 'tool execution aborted' };
    }
    return { ok: false, code: 'execution-failed', message: acquired.reason };
  }
  const gateFacts: WorkspaceWriteToolDetails = {
    lock: input.mode,
    queuedMs: Math.max(0, now() - queuedAt),
  };

  const gate = input.workspaceWrite.gate;
  const fileKey = paths?.[0];
  /** This session has not seen another session's change to the file yet. */
  let unseenForeignChange = false;
  try {
    if (input.signal.aborted) {
      return { ok: false, code: 'aborted', message: 'tool execution aborted' };
    }
    if (input.mode === 'shared' && input.filePath && fileKey !== undefined) {
      const again = await resolveFileLockKey(input.filePath);
      if (!again.ok || again.key !== fileKey) {
        return {
          ok: false,
          code: 'execution-failed',
          message: 'write path identity changed before write',
        };
      }
      if (input.ownerId !== undefined) {
        const foreign = await judgeLedgerEntry({
          gate,
          root: acquired.lease.root,
          ownerId: input.ownerId,
          fileKey,
        });
        if (foreign?.verdict.conflict) {
          if (input.foreignChangeCheck !== false) {
            // Refuse once. The model is told to re-read; a deliberate retry then wins.
            gate.fileLedger.record(input.ownerId, fileKey, {
              sha: foreign.currentSha,
              tick: gate.activity.now(),
            });
            return withGateFacts(foreignChangeRefusal(foreign.verdict.byHostWrite), gateFacts);
          }
          unseenForeignChange = true;
        }
        if (
          foreign === undefined &&
          input.foreignChangeCheck === false &&
          gate.activity.othersSince({
            root: acquired.lease.root,
            fromTick: 0,
            ownerId: input.ownerId,
            fileKey,
          }).fileWrites.length > 0
        ) {
          // First write by this session to a file others wrote: Host cannot
          // tell which version it read. An edit is still safe; a later
          // whole-file overwrite should re-read first.
          gate.fileLedger.record(input.ownerId, fileKey, { sha: UNKNOWN_VERSION_SHA, tick: 0 });
          unseenForeignChange = true;
        }
      }
    }
    const result = await input.run({
      gate,
      root: acquired.lease.root,
      grantedAtTick: acquired.lease.grantedAtTick,
      ownerId: input.ownerId,
    });
    // An `edit` over another session's unseen change must not vouch for the
    // whole file: keep the old entry so a later whole-file overwrite is caught.
    if (result.ok && input.ownerId !== undefined && fileKey !== undefined && !unseenForeignChange) {
      gate.fileLedger.record(input.ownerId, fileKey, {
        sha: await hashFileOrNull(fileKey),
        tick: gate.activity.now(),
      });
    }
    return withGateFacts(result, gateFacts);
  } finally {
    acquired.lease.release();
  }
}

async function judgeLedgerEntry(input: {
  gate: WorkspaceWriteGate;
  root: string;
  ownerId: string;
  fileKey: string;
}): Promise<{ verdict: ForeignFileChangeVerdict; currentSha: string | null } | undefined> {
  const entry = input.gate.fileLedger.lookup(input.ownerId, input.fileKey);
  if (entry === undefined) {
    return undefined;
  }
  const currentSha = await hashFileOrNull(input.fileKey);
  const verdict = judgeForeignFileChange({
    entry,
    currentSha,
    others: input.gate.activity.othersSince({
      root: input.root,
      fromTick: entry.tick,
      ownerId: input.ownerId,
      fileKey: input.fileKey,
    }),
    ownShellCount: input.gate.activity.ownShellCountSince({
      root: input.root,
      fromTick: entry.tick,
      ownerId: input.ownerId,
    }),
  });
  return { verdict, currentSha };
}

function foreignChangeRefusal(byHostWrite: boolean): ToolResult {
  return {
    ok: false,
    code: 'execution-failed',
    message: byHostWrite
      ? 'file changed since your last write: another session wrote it. Read the file again and merge before writing.'
      : 'file changed since your last write while another session was running commands in this workspace. Read the file again and merge before writing.',
    details: { reason: 'file-changed-by-other-session' },
    retryable: true,
  };
}

async function hashFileOrNull(path: string): Promise<string | null> {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex');
  } catch {
    return null;
  }
}

function withGateFacts(result: ToolResult, facts: WorkspaceWriteToolDetails): ToolResult {
  const workspaceWrite: WorkspaceWriteToolDetails = {
    ...facts,
    ...(result.details?.workspaceWrite?.concurrentChanges
      ? { concurrentChanges: result.details.workspaceWrite.concurrentChanges }
      : {}),
  };
  return { ...result, details: { ...result.details, workspaceWrite } };
}
