import {
  estimateHostTokens,
  type ContextUsageSnapshot,
  type SessionTranscriptMessage,
} from '@piwin/contracts';
import { getSessionRecord } from '@piwin/session';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { isExternalRecord } from './grok/grok-session-router.js';

export function estimateTranscriptMessagesTokens(
  messages: readonly SessionTranscriptMessage[],
): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.text === 'string' && message.text.length > 0) {
      total += estimateHostTokens(message.text);
    }
    if (typeof message.thinking === 'string' && message.thinking.length > 0) {
      total += estimateHostTokens(message.thinking);
    }
  }
  return total;
}

export async function maybeEstimateExternalSessionContext(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<void> {
  try {
    const rootDir = getPiwinRoot(deps.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = await getSessionRecord(indexPath, sessionId);
    if (!record || !isExternalRecord(record)) {
      return;
    }

    const store = await deps.getTranscriptStore(sessionId);
    const page = await store.transcriptPage({
      sessionId,
      limit: 200,
      maximumBytes: 5 * 1024 * 1024,
    });
    if (page.status !== 'page') {
      return;
    }

    const tokens = estimateTranscriptMessagesTokens(page.messages);
    if (tokens <= 0) {
      return;
    }

    const usage: ContextUsageSnapshot = {
      sessionId,
      totalTokens: tokens,
      tokensUsed: tokens,
      tokensLimit: 256_000,
      source: 'host-estimate',
      updatedAt: new Date().toISOString(),
    };

    deps.push({
      type: 'event',
      sessionId,
      event: { type: 'usage/update', sessionId, usage },
    });
  } catch (error) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `external session context estimate failed for ${sessionId}: ${error instanceof Error ? error.message : 'error'}`,
    });
  }
}
