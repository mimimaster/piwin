import type { ToolFileChange, ToolPresentation } from '@piwin/contracts';

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function readCount(value: unknown): number | null | undefined {
  if (value === null) return null;
  return readNonNegative(value);
}

function readFileChange(value: unknown): ToolFileChange | undefined {
  const record = readRecord(value);
  if (!record || typeof record.path !== 'string' || record.path.length === 0) return undefined;
  const status = record.status;
  if (status !== 'added' && status !== 'modified' && status !== 'deleted') return undefined;
  const additions = readCount(record.additions);
  const deletions = readCount(record.deletions);
  if (additions === undefined || deletions === undefined) return undefined;
  return {
    path: record.path,
    status,
    additions,
    deletions,
    binary: record.binary === true,
    ...(typeof record.patch === 'string' ? { patch: record.patch } : {}),
  };
}

/**
 * Lift Host write-gate facts so the card can show waiting apart from running,
 * and a file tool's own change so its diff is this call's, not the file's
 * whole working-tree diff. Tool events carry no timing of their own; the gate
 * measures queue + execution, so that fills `durationMs` when it is missing.
 */
export function attachWorkspaceWritePresentation(
  presentation: ToolPresentation,
  input: { details?: unknown },
): ToolPresentation {
  const details = readRecord(input.details);
  if (!details) {
    return presentation;
  }
  const next: ToolPresentation = { ...presentation };
  const workspaceWrite = readRecord(details.workspaceWrite);
  if (workspaceWrite) {
    const queuedMs = readNonNegative(workspaceWrite.queuedMs);
    const executionMs = readNonNegative(workspaceWrite.executionMs);
    if (queuedMs !== undefined && queuedMs > 0) {
      next.queuedMs = queuedMs;
    }
    if (next.durationMs === undefined && executionMs !== undefined) {
      next.durationMs = (queuedMs ?? 0) + executionMs;
    }
  }
  const fileChange = readFileChange(details.fileChange);
  if (fileChange) {
    next.fileChange = fileChange;
  }
  return next;
}
