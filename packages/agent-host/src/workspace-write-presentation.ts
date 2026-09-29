import type { ToolPresentation } from '@piwin/contracts';

/**
 * Lift the Host write-gate queue time so the card can show waiting apart from
 * running. Only positive, finite values; any tool may carry it.
 */
export function attachWorkspaceWritePresentation(
  presentation: ToolPresentation,
  input: { details?: unknown },
): ToolPresentation {
  if (!input.details || typeof input.details !== 'object' || Array.isArray(input.details)) {
    return presentation;
  }
  const workspaceWrite = (input.details as Record<string, unknown>).workspaceWrite;
  if (!workspaceWrite || typeof workspaceWrite !== 'object') {
    return presentation;
  }
  const queuedMs = (workspaceWrite as Record<string, unknown>).queuedMs;
  if (typeof queuedMs !== 'number' || !Number.isFinite(queuedMs) || queuedMs <= 0) {
    return presentation;
  }
  return { ...presentation, queuedMs: Math.round(queuedMs) };
}
