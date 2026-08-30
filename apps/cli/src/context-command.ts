/**
 * CLI assembly-summary read path (M1).
 *
 * `piwin context <sessionId>` prints Host-owned assembly only. It never claims
 * the model received this payload and never dumps raw system / tools / files.
 */
import type {
  HostCommand,
  HostResponse,
  ModelContextSummaryData,
  SessionContextSnapshot,
} from '@piwin/contracts';
import { parseSessionContextSnapshot } from '@piwin/contracts';

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

export function formatSessionContextOccupancy(
  snapshot: SessionContextSnapshot,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): string {
  const quality =
    snapshot.occupancy.kind === 'unknown'
      ? locale === 'zh-CN'
        ? '未知'
        : 'unknown'
      : snapshot.occupancy.quality === 'measured'
        ? locale === 'zh-CN'
          ? '已确认'
          : 'confirmed'
        : locale === 'zh-CN'
          ? '估算'
          : 'estimated';
  if (snapshot.occupancy.kind === 'unknown') {
    return locale === 'zh-CN'
      ? `上下文占用\t${quality}\t${snapshot.occupancy.reason}`
      : `context occupancy\t${quality}\t${snapshot.occupancy.reason}`;
  }
  const used = snapshot.occupancy.tokensUsed;
  const limit = snapshot.occupancy.tokensLimit;
  const tokens =
    typeof limit === 'number' ? `${used}/${limit}` : `${used}`;
  return locale === 'zh-CN'
    ? `上下文占用\t${quality}\t${tokens}`
    : `context occupancy\t${quality}\t${tokens}`;
}

export async function runContextSummary(
  client: ContextHostClient,
  sessionId: string,
  write: (line: string) => void,
): Promise<void> {
  const occupancyResponse = await client.handleCommand({
    type: 'session/context-get',
    sessionId,
  });
  if (occupancyResponse.success) {
    const snapshot = parseSessionContextSnapshot(occupancyResponse.data);
    if (snapshot) {
      write(formatSessionContextOccupancy(snapshot));
    }
  }
  const response = await client.handleCommand({
    type: 'session/model-context-summary',
    sessionId,
  });
  if (!response.success) {
    throw new Error(response.error);
  }
  write(formatContextSummary(response.data as ModelContextSummaryData));
}
