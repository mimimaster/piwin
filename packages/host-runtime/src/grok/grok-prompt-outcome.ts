/**
 * Map one Grok `session/prompt` result onto the product outcome and usage
 * measurement (ADR 0082). Pure: no transport, no Host state.
 */

import {
  classifyGrokStopReason,
  parseGrokPromptUsage,
  type AcpContentBlock,
  type AcpPromptResult,
} from '@piwin/acp-agent';
import type { AgentEvent, AgentPromptOutcome, PromptInput } from '@piwin/contracts';
import { createUnknownAgentFailure, formatError } from '@piwin/contracts';

export type GrokTurnContext = {
  productSessionId: string;
  runId: string | undefined;
  lastAssistantMessageId: string | undefined;
  userCancelled: boolean;
  permissionRejected: boolean;
  recordedAt: string;
};

export type GrokTurnResult = {
  outcome: AgentPromptOutcome;
  /** How open tool cards / messages should be closed. */
  finish: 'completed' | 'aborted' | 'failed';
  usageEvent?: AgentEvent;
};

export function mapGrokPromptResult(result: AcpPromptResult, context: GrokTurnContext): GrokTurnResult {
  const terminal = classifyGrokStopReason(result.stopReason, {
    userCancelled: context.userCancelled,
    permissionRejected: context.permissionRejected,
  });
  const usageEvent = buildUsageEvent(result, context);
  switch (terminal.status) {
    case 'completed':
      return {
        outcome: { status: 'completed', stopReason: terminal.stopReason },
        finish: 'completed',
        ...(usageEvent ? { usageEvent } : {}),
      };
    case 'aborted':
      // A rejected permission ends Grok's turn as `cancelled`; to the user it
      // is a handled outcome, not a Stop and not a failure.
      return {
        outcome:
          terminal.reason === 'permission-rejected'
            ? { status: 'completed', stopReason: 'handled' }
            : { status: 'aborted', stopReason: 'aborted' },
        finish: 'aborted',
        ...(usageEvent ? { usageEvent } : {}),
      };
    case 'failed':
      return {
        outcome: { status: 'failed', stopReason: 'error', failure: createUnknownAgentFailure(terminal.message) },
        finish: 'failed',
        ...(usageEvent ? { usageEvent } : {}),
      };
  }
}

/** Outcome when `session/prompt` itself rejected (transport or protocol error). */
export function mapGrokPromptError(
  error: unknown,
  context: { userCancelled: boolean; connectionClosed: boolean },
): AgentPromptOutcome {
  if (context.userCancelled) {
    return { status: 'aborted', stopReason: 'aborted' };
  }
  return {
    status: 'failed',
    stopReason: 'error',
    failure: {
      code: context.connectionClosed ? 'backend-worker-crash' : 'backend-protocol-error',
      origin: 'protocol',
      message: `Grok: ${formatError(error)}`.slice(0, 500),
      retriable: false,
    },
  };
}

function buildUsageEvent(result: AcpPromptResult, context: GrokTurnContext): AgentEvent | undefined {
  const usage = parseGrokPromptUsage(result._meta);
  const messageId = context.lastAssistantMessageId;
  if (usage === undefined || messageId === undefined) {
    return undefined;
  }
  return {
    type: 'usage/finalized',
    measurement: {
      measurementId: `${context.productSessionId}:${messageId}`,
      sessionId: context.productSessionId,
      ...(context.runId !== undefined ? { runId: context.runId } : {}),
      messageId,
      ...(usage.modelId !== undefined ? { modelId: usage.modelId } : {}),
      ...(usage.inputTokens !== undefined ? { promptTokens: usage.inputTokens } : {}),
      ...(usage.outputTokens !== undefined ? { completionTokens: usage.outputTokens } : {}),
      ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
      ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
      totalTokens: usage.totalTokens,
      ...(usage.durationMs !== undefined ? { durationMs: usage.durationMs } : {}),
      stopReason: result.stopReason,
      recordedAt: context.recordedAt,
    },
  };
}

/** Plain text plus `@` file refs as ACP resource links. */
export function toGrokContentBlocks(input: PromptInput): AcpContentBlock[] {
  const blocks: AcpContentBlock[] = [{ type: 'text', text: input.text }];
  for (const ref of input.contextRefs ?? []) {
    if (ref.kind === 'file') {
      const path = `${ref.projectPath.replace(/\/$/, '')}/${ref.relativePath}`;
      blocks.push({ type: 'resource_link', uri: `file://${path}`, name: ref.label });
    }
  }
  return blocks;
}

/** Poll until `predicate` holds or `timeoutMs` elapses. */
export async function waitForCondition(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}
