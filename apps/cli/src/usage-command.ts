import type { UsageRollup } from '@piwin/contracts';
import { openCliHost } from './cli-host.js';
import { computePromptCacheHitRate } from '@piwin/contracts';
import { hasFlag, parseMock, parseOptionalProject } from './cli-args.js';

/**
 * `piwin usage` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandUsage(argv: string[]): Promise<void> {
  const mock = parseMock(argv);
  const projectPath = parseOptionalProject(argv);
  const globalFlag = hasFlag(argv, '--global');
  const runtime = await openCliHost({
    mode: 'sdk',
    mock,
  });
  try {
    const response = await runtime.handleCommand({
      type: 'usage/get-rollup',
      ...(globalFlag || !projectPath ? {} : { projectPath }),
      topSessions: 10,
    });
    if (!response.success) {
      console.error(response.error);
      process.exitCode = 1;
      return;
    }
    const rollup = (response.data as { rollup?: UsageRollup }).rollup;
    if (!rollup) {
      console.error('No rollup returned.');
      process.exitCode = 1;
      return;
    }
    const scope =
      rollup.scope.kind === 'global'
        ? 'global'
        : rollup.scope.kind === 'project'
          ? rollup.scope.projectPath
          : 'general';
    console.log(`piwin usage — ${scope}`);
    console.log('---');
    console.log(
      `total tokens: ${formatUsageNumber(rollup.totalTokens)}  ` +
        `input: ${formatUsageNumber(rollup.promptTokens)}  ` +
        `output: ${formatUsageNumber(rollup.completionTokens)}  ` +
        `cache read: ${formatUsageNumber(rollup.cacheReadTokens ?? 0)}  ` +
        `cache write: ${formatUsageNumber(rollup.cacheWriteTokens ?? 0)}  ` +
        `cache hit: ${formatUsageRate(computePromptCacheHitRate(rollup))}  ` +
        `sessions: ${rollup.sessionCount}  turns: ${rollup.entryCount}`,
    );
    if (rollup.firstAt) {
      console.log(`range: ${rollup.firstAt.slice(0, 10)} → ${rollup.lastAt?.slice(0, 10) ?? ''}`);
    }
    if (rollup.byModelKey.length > 0) {
      console.log('--- by model + key ---');
      for (const bucket of rollup.byModelKey) {
        const keyLabel = bucket.providerId ?? 'unknown (legacy)';
        console.log(
          `${bucket.modelId}\tkey=${keyLabel}\t${formatUsageNumber(bucket.totalTokens)} total\t` +
            `${formatUsageNumber(bucket.promptTokens)} in\t${formatUsageNumber(bucket.completionTokens)} out\t` +
            `${formatUsageNumber(bucket.cacheReadTokens ?? 0)} cache-read\t` +
            `${formatUsageNumber(bucket.cacheWriteTokens ?? 0)} cache-write\t` +
            `${formatUsageRate(computePromptCacheHitRate(bucket))} cache-hit`,
        );
      }
    }
    if (rollup.bySession.length > 0) {
      console.log('--- by session (top) ---');
      for (const session of rollup.bySession) {
        console.log(
          `${session.sessionId}\t${formatUsageNumber(session.totalTokens)} total\t` +
            `${session.entryCount} turns`,
        );
      }
    }
  } finally {
    await runtime.dispose();
  }
}

export function formatUsageNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatUsageRate(value: number | null): string {
  return value === null ? 'unknown' : `${Math.round(value * 100)}%`;
}
