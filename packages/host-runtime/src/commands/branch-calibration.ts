/**
 * One-shot workspace calibration after a conversation-tree switch (ADR 0055).
 * Disk does not follow the leaf — tell the next prompt what the abandoned
 * branch wrote and what git currently sees.
 *
 * Pending calibration is durable under the session dir so a Host restart
 * before the next prompt still injects once, then clears the file.
 */

import { mkdir, readFile, rm } from 'node:fs/promises';
import type { PromptInput, WorkspaceWrites } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { probeGitRepository, readGitDiffSummary, readGitStatus } from '@piwin/git';
import { getSessionRecord, writeTextFileAtomic } from '@piwin/session';
import {
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionIndexPath,
  getPiwinSessionPendingBranchCalibrationPath,
} from '../paths.js';
import type { SessionLiveContext } from './session-live-context.js';

const MAX_CALIBRATION_FILES = 40;
const MAX_CALIBRATION_CHARS = 4_000;

export function formatBranchCalibrationBlock(
  writes: WorkspaceWrites,
  gitSnapshot: string,
): string {
  const lines = [
    '[piwin-branch-calibration]',
    'The conversation switched branches. Disk files were not reverted.',
  ];
  if (writes.files.length > 0) {
    lines.push('Abandoned-branch writes:');
    for (const file of writes.files.slice(0, MAX_CALIBRATION_FILES)) {
      lines.push(`- ${file}`);
    }
    if (writes.files.length > MAX_CALIBRATION_FILES) {
      lines.push(`- … ${writes.files.length - MAX_CALIBRATION_FILES} more`);
    }
  }
  if (writes.hasUnknownWrites) {
    lines.push('It also ran commands that may have written files without recording paths.');
  }
  if (gitSnapshot.trim().length > 0) {
    lines.push('Current git snapshot:');
    lines.push(gitSnapshot.trim());
  }
  lines.push('[/piwin-branch-calibration]');
  return lines.join('\n');
}

export async function readWorkspaceCalibrationSnapshot(projectPath: string): Promise<string> {
  const repository = await probeGitRepository(projectPath);
  if (!repository.isRepository) {
    return 'Not a git repository.';
  }
  const status = await readGitStatus({ repository, maxFiles: MAX_CALIBRATION_FILES });
  const diff = await readGitDiffSummary({ repository, maxFiles: MAX_CALIBRATION_FILES });
  const lines: string[] = [];
  if (status.branch?.currentBranch) {
    lines.push(`branch ${status.branch.currentBranch}`);
  }
  if (status.changedFiles.length === 0) {
    lines.push('git status: clean');
  } else {
    lines.push('git status --porcelain:');
    for (const file of status.changedFiles) {
      lines.push(`${file.status} ${file.path}`);
    }
    if (status.truncated) {
      lines.push(`… ${status.totalChangedFiles - status.changedFiles.length} more`);
    }
  }
  if (diff.files.length > 0) {
    lines.push(
      `git diff --stat: ${diff.totalFiles} files +${diff.totalAdditions} -${diff.totalDeletions}`,
    );
    for (const file of diff.files) {
      lines.push(`${file.path} +${file.additions} -${file.deletions}`);
    }
  }
  return lines.join('\n').slice(0, MAX_CALIBRATION_CHARS);
}

/** Queue calibration in memory and on disk until the next prompt consumes it. */
export async function queuePendingBranchCalibration(
  context: SessionLiveContext,
  sessionId: string,
  writes: WorkspaceWrites,
): Promise<void> {
  context.pendingBranchCalibrationBySession.set(sessionId, writes);
  const rootDir = getPiwinRoot(context.piwinRoot);
  const filePath = getPiwinSessionPendingBranchCalibrationPath(rootDir, sessionId);
  await mkdir(getPiwinSessionDir(rootDir, sessionId), { recursive: true });
  await writeTextFileAtomic(filePath, `${JSON.stringify(writes)}\n`);
}

export async function loadPendingBranchCalibration(
  context: SessionLiveContext,
  sessionId: string,
): Promise<WorkspaceWrites | undefined> {
  const cached = context.pendingBranchCalibrationBySession.get(sessionId);
  if (cached !== undefined) {
    return cached;
  }
  const fromDisk = await readPendingBranchCalibrationFile(context, sessionId);
  if (fromDisk !== undefined) {
    context.pendingBranchCalibrationBySession.set(sessionId, fromDisk);
  }
  return fromDisk;
}

export async function clearPendingBranchCalibration(
  context: SessionLiveContext,
  sessionId: string,
): Promise<void> {
  context.pendingBranchCalibrationBySession.delete(sessionId);
  const filePath = getPiwinSessionPendingBranchCalibrationPath(
    getPiwinRoot(context.piwinRoot),
    sessionId,
  );
  await rm(filePath, { force: true });
}

async function readPendingBranchCalibrationFile(
  context: SessionLiveContext,
  sessionId: string,
): Promise<WorkspaceWrites | undefined> {
  const filePath = getPiwinSessionPendingBranchCalibrationPath(
    getPiwinRoot(context.piwinRoot),
    sessionId,
  );
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isWorkspaceWrites(parsed)) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `pending branch calibration read failed: ${formatError(error)}`,
    });
    return undefined;
  }
}

function isWorkspaceWrites(value: unknown): value is WorkspaceWrites {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as { files?: unknown; hasUnknownWrites?: unknown };
  return (
    Array.isArray(record.files) &&
    record.files.every((file) => typeof file === 'string') &&
    typeof record.hasUnknownWrites === 'boolean'
  );
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

export async function injectBranchCalibrationOnce(
  context: SessionLiveContext,
  sessionId: string,
  promptInput: PromptInput,
): Promise<void> {
  const writes = await loadPendingBranchCalibration(context, sessionId);
  if (writes === undefined) {
    return;
  }
  // The abandoned-file list is the half the model cannot re-derive on its own,
  // so a failing git probe degrades the block instead of dropping it.
  let snapshot = '';
  try {
    const record = await getSessionRecord(
      getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot)),
      sessionId,
    );
    const projectPath = record?.projectPath ?? record?.workingDirectory;
    if (projectPath !== undefined && projectPath.length > 0) {
      snapshot = await readWorkspaceCalibrationSnapshot(projectPath);
    }
  } catch (error) {
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `branch calibration git snapshot failed: ${formatError(error)}`,
    });
  }
  promptInput.text = `${formatBranchCalibrationBlock(writes, snapshot)}\n\n${promptInput.text}`;
  // Consume only after a successful inject so a Host restart still replays once.
  await clearPendingBranchCalibration(context, sessionId);
}
