/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { estimateMockUsage } from '@piwin/agent-host';
import { formatError, shouldAcceptContextUsage } from '@piwin/contracts';

import { appendUsageRecord, readLatestSessionContextUsage } from '@piwin/session';
import type { ContextUsageSnapshot, UsageRecord } from '@piwin/contracts';
import { getPiwinRoot, getPiwinUsageLedgerPath } from './paths.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';

export async function recordUsageToLedger(
  deps: HostRuntimeKernel,
  sessionId: string,
  usage: ContextUsageSnapshot,
): Promise<void> {
  const totalTokens = usage.totalTokens ?? usage.tokensUsed;
  if (totalTokens === undefined || !Number.isFinite(totalTokens)) {
    return;
  }
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const ledgerPath = getPiwinUsageLedgerPath(rootDir);
  const projectPath = deps.sessionProjects.get(sessionId) ?? '';
  const modelRef = deps.sessionModels.get(sessionId);
  const modelId = usage.modelId ?? modelRef?.modelId;
  const record: UsageRecord = {
    sessionId,
    projectPath: projectPath.trim().length > 0 ? projectPath : null,
    ...(modelRef?.providerId ? { providerId: modelRef.providerId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(usage.promptTokens !== undefined ? { promptTokens: usage.promptTokens } : {}),
    ...(usage.completionTokens !== undefined ? { completionTokens: usage.completionTokens } : {}),
    ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    ...(usage.durationMs !== undefined ? { durationMs: usage.durationMs } : {}),
    totalTokens,
    source: usage.source === 'host-estimate' ? 'host-estimate' : 'assistant-usage',
    recordedAt: new Date().toISOString(),
  };
  try {
    await appendUsageRecord(ledgerPath, record);
  } catch (error) {
    const message = formatError(error);
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `usage ledger write failed: ${message}`,
    });
  }
}

export function enqueueUsageLedgerWrite(
  deps: HostRuntimeKernel,
  sessionId: string,
  usage: ContextUsageSnapshot,
): void {
  const write = deps.recordUsageToLedger(sessionId, usage);
  deps.pendingUsageLedgerWrites.add(write);
  void write.then(
    () => {
      deps.pendingUsageLedgerWrites.delete(write);
    },
    (error: unknown) => {
      deps.pendingUsageLedgerWrites.delete(write);
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `usage ledger write failed: ${formatError(error)}`,
      });
    },
  );
}

export async function flushUsageLedgerWrites(deps: HostRuntimeKernel): Promise<void> {
  while (deps.pendingUsageLedgerWrites.size > 0) {
    await Promise.allSettled([...deps.pendingUsageLedgerWrites]);
  }
}

export async function loadSessionUsage(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<ContextUsageSnapshot | null> {
  const cached = deps.sessionUsage.get(sessionId);
  if (cached) {
    return cached;
  }
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const restored = await readLatestSessionContextUsage(getPiwinUsageLedgerPath(rootDir), sessionId);
  if (restored) {
    deps.sessionUsage.set(sessionId, restored);
  }
  return restored;
}

export async function maybeEmitUsageOnMessageEnd(
  deps: HostRuntimeKernel,
  sessionId: string,
  messageId: string,
): Promise<void> {
  const existing = deps.sessionUsage.get(sessionId);
  if (existing && existing.source !== 'host-estimate') {
    return;
  }
  if (existing && existing.updatedAt) {
    const ageMs = Date.now() - Date.parse(existing.updatedAt);
    if (Number.isFinite(ageMs) && ageMs < 2000) {
      return;
    }
  }
  try {
    const message = await (await deps.getTranscriptStore(sessionId)).getMessage(messageId);
    if (!message || message.role !== 'assistant') {
      return;
    }
    const promptText = deps.sessionLastPromptText.get(sessionId) ?? '';
    // Fallback estimate: assistant message end minus transcript creation is a
    // loose end-to-end turn duration; cap it so stale transcripts never
    // poison tok/s with an unbounded span.
    let estimatedDurationMs: number | undefined;
    const createdAt = Date.parse(message.createdAt ?? '');
    if (Number.isFinite(createdAt)) {
      const ageMs = Date.now() - createdAt;
      if (ageMs > 0 && ageMs <= 30 * 60 * 1000) {
        estimatedDurationMs = ageMs;
      }
    }
    const usage = estimateMockUsage(sessionId, promptText, message.text, estimatedDurationMs);
    const currentUsage = deps.sessionUsage.get(sessionId);
    if (!shouldAcceptContextUsage(currentUsage, usage)) {
      return;
    }
    deps.sessionUsage.set(sessionId, usage);
    deps.enqueueUsageLedgerWrite(sessionId, usage);
    deps.push({
      type: 'event',
      sessionId,
      event: { type: 'usage/update', sessionId, usage },
    });
  } catch {
    // best-effort
  }
}
