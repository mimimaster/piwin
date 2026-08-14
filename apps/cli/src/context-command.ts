/**
 * CLI assembly-summary read path (M1).
 *
 * `piwin context <sessionId>` prints Host-owned assembly only. It never claims
 * the model received this payload and never dumps raw system / tools / files.
 */
import type { HostCommand, HostResponse, ModelContextSummaryData } from '@piwin/contracts';

export type ContextHostClient = {
  handleCommand: (command: HostCommand) => Promise<HostResponse>;
  dispose: () => Promise<void>;
};

export function formatContextSummary(data: ModelContextSummaryData): string {
  const header = `coverage\t${data.coverage}`;
  if (data.summaries.length === 0) {
    return `${header}\n(no assembly summaries)`;
  }
  const blocks = data.summaries.map((summary) => {
    const tokens =
      summary.totalEstimatedTokens === undefined
        ? 'estimate unknown'
        : `~${summary.totalEstimatedTokens} tokens (estimate)`;
    const lines = [
      `${summary.runId}\t${summary.requestClass}#${summary.requestOrdinal}\t${summary.coverage}\t${tokens}`,
    ];
    for (const item of summary.contributions) {
      const label = item.displayPath ?? item.label;
      const itemTokens =
        item.estimatedTokens === undefined ? '' : `\t~${item.estimatedTokens}`;
      lines.push(`  ${item.kind}\t${label}${itemTokens}`);
    }
    return lines.join('\n');
  });
  return [header, ...blocks].join('\n');
}

export async function runContextSummary(
  client: ContextHostClient,
  sessionId: string,
  write: (line: string) => void,
): Promise<void> {
  const response = await client.handleCommand({
    type: 'session/model-context-summary',
    sessionId,
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  write(formatContextSummary(response.data as ModelContextSummaryData));
}
