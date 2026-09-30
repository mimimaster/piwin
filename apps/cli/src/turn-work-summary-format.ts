import type { SessionTurnSummary } from '@piwin/contracts';

/** CLI consumes the same complete Host totals as the Desktop fold header. */
export function formatTurnWorkSummary(summary: SessionTurnSummary): string {
  return [
    `- turn: ${summary.turnId}`,
    `- tools: ${summary.toolCount}`,
    `- files: ${summary.fileCount}`,
    `- failures: ${summary.failureCount}`,
    ...(summary.elapsedMs === undefined ? [] : [`- worked: ${summary.elapsedMs}ms`]),
  ].join('\n');
}
