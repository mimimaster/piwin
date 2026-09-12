/**
 * Single Host consumption of AgentPromptOutcome. RunRegistry remains the only
 * terminal mutation API; this module only chooses which terminate call to make.
 */

import type { AgentFailure, AgentPromptOutcome } from '@piwin/contracts';
import { isV1SubscriptionProviderId } from '@piwin/contracts';
import { formatError, sanitizeAgentFailure } from '@piwin/contracts';
import { finalizeAbortedRun } from './run-control-commands.js';
import type { SessionLiveContext } from './session-live-context.js';
import { isRunAbortReason } from '../run-abort-reason.js';

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
      // Pi often reports a user stop as stopReason=error + abort prose.
      // Host already owns that stop; do not paint a red generation failure.
      if (hasHostAbortReason(context, runId)) {
        await finalizeAbortedRun(context, sessionId, runId, { agentStopReason: 'aborted' });
        return 'aborted-by-host';
      }
      await persistStructuredFailureIfNeeded(context, sessionId, runId, outcome.failure);
      noteSubscriptionAuthFailure(context, sessionId, outcome.failure);
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

function noteSubscriptionAuthFailure(
  context: SessionLiveContext,
  sessionId: string,
  failure: AgentFailure,
): void {
  if (failure.code !== 'provider-authentication') {
    return;
  }
  const model = context.sessionModels.get(sessionId);
  if (!model) {
    return;
  }
  if (model.source === 'channel') {
    return;
  }
  if (model.source === 'subscription' || isV1SubscriptionProviderId(model.providerId)) {
    context.noteSubscriptionAuthFailure?.(model.providerId);
  }
}

function hasHostAbortReason(context: SessionLiveContext, runId: string): boolean {
  if (context.getRunAbortReason(runId) !== undefined) return true;
  if (context.isPauseRequested(runId)) return true;
  const signal = context.getRunSignal(runId);
  return signal?.aborted === true && isRunAbortReason(signal.reason);
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
  const alreadyPushedEvidence = context.hasRunAgentErrorEvidence(runId);
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
      await persistSyntheticFailureRow(context, sessionId, runId, failure);
    }
  } else {
    await persistSyntheticFailureRow(context, sessionId, runId, failure);
  }
  if (!alreadyPushedEvidence) {
    context.push({
      type: 'event',
      sessionId,
      event: errorEvent,
    });
  }
}

async function persistSyntheticFailureRow(
  context: SessionLiveContext,
  sessionId: string,
  runId: string,
  failure: AgentFailure,
): Promise<void> {
  try {
    const store = await context.getTranscriptStore(sessionId);
    await store.ensureFailedRunAssistant({
      runId,
      updatedAt: new Date().toISOString(),
      terminalMessage: failure.message,
      failure,
    });
  } catch (error) {
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `synthetic failure row persist failed: ${formatError(error)}`,
    });
  }
}
