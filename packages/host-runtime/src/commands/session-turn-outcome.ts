/**
 * Single Host consumption of AgentPromptOutcome. RunRegistry remains the only
 * terminal mutation API; this module only chooses which terminate call to make.
 */

import type { AgentFailure, AgentPromptOutcome } from '@piwin/contracts';
import { formatError, sanitizeAgentFailure } from '@piwin/contracts';
import { finalizeAbortedRun } from './run-control-commands.js';
import type { SessionLiveContext } from './session-live-context.js';

export type AgentPromptOutcomeApplication = 'completed' | 'failed' | 'aborted-by-host';

export async function applyAgentPromptOutcome(input: {
  context: SessionLiveContext;
  sessionId: string;
  runId: string;
  outcome: AgentPromptOutcome;
}): Promise<AgentPromptOutcomeApplication> {
  const { context, sessionId, runId, outcome } = input;
  switch (outcome.status) {
    case 'completed':
      return 'completed';
    case 'failed':
      await persistStructuredFailureIfNeeded(context, sessionId, runId, outcome.failure);
      await context.terminateRun(sessionId, runId, 'failed', undefined, outcome.failure.message, {
        agentStopReason: outcome.stopReason,
        failure: outcome.failure,
      });
      return 'failed';
    case 'aborted':
      if (hasHostAbortReason(context, runId)) {
        await finalizeAbortedRun(context, sessionId, runId, { agentStopReason: 'aborted' });
        return 'aborted-by-host';
      }
      {
        const failure = spontaneousAbortFailure(outcome.message);
        await persistStructuredFailureIfNeeded(context, sessionId, runId, failure);
        await context.terminateRun(sessionId, runId, 'failed', undefined, failure.message, {
          agentStopReason: 'aborted',
          failure,
        });
        return 'failed';
      }
  }
}

export async function persistHostRuntimeFailure(input: {
  context: SessionLiveContext;
  sessionId: string;
  runId: string;
  failure: AgentFailure;
}): Promise<void> {
  await persistStructuredFailureIfNeeded(input.context, input.sessionId, input.runId, input.failure);
}

function hasHostAbortReason(context: SessionLiveContext, runId: string): boolean {
  return context.getRunSignal(runId)?.aborted === true || context.isPauseRequested(runId);
}

function spontaneousAbortFailure(message?: string): AgentFailure {
  return sanitizeAgentFailure({
    code: 'unknown-agent-failure',
    origin: 'transport',
    message: message ?? 'Pi prompt aborted without a Host abort reason',
    retriable: true,
  });
}

async function persistStructuredFailureIfNeeded(
  context: SessionLiveContext,
  sessionId: string,
  runId: string,
  failure: AgentFailure,
): Promise<void> {
  if (context.hasRunAgentErrorEvidence(runId)) {
    return;
  }
  const errorEvent = {
    type: 'error' as const,
    message: failure.message,
    retriable: failure.retriable,
    runId,
    failure,
  };
  const recorder = context.transcriptRecorders.get(sessionId);
  if (recorder) {
    try {
      await recorder.recordEvent(errorEvent);
      await recorder.flush();
    } catch (error) {
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `transcript failure evidence persist failed: ${formatError(error)}`,
      });
    }
  }
  context.push({
    type: 'event',
    sessionId,
    event: errorEvent,
  });
}
