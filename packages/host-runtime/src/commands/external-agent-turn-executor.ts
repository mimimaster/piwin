/**
 * Detached turn execution for external agent sessions (ADR 0082).
 *
 * Shares admission, Run registration and terminalization with the Pi path in
 * `session-prompt-command.ts`, but skips every Pi-only preparation step:
 * skills, plan/orchestration contracts, product history injection, model
 * runtime replacement and delegation. The vendor backend receives the user's
 * text and attachments verbatim (plus `@` file refs).
 */

import type { ExecutionRunRecord, PromptInput } from '@piwin/contracts';
import { createUnknownAgentFailure, formatError } from '@piwin/contracts';
import { randomUUID } from 'node:crypto';
import type { SessionLiveContext } from './session-live-context.js';
import { TURN_CONTINUATION_PROMPT, type PromptCommand } from './prompt-preparation.js';
import { finalizeAbortedRun } from './run-control-commands.js';
import { applyAgentPromptOutcome, persistHostRuntimeFailure } from './session-turn-outcome.js';

/** Pi vision routing never rewrites this payload; attachments stay Host media refs. */
export function buildExternalAgentPrompt(input: PromptCommand['input']): PromptInput {
  const continuation = input.source === 'continuation';
  return {
    text: continuation ? TURN_CONTINUATION_PROMPT : input.text,
    ...(input.contextRefs !== undefined ? { contextRefs: input.contextRefs } : {}),
    ...(input.attachments !== undefined && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
  };
}

export async function executeExternalAgentTurn(input: {
  context: SessionLiveContext;
  command: PromptCommand;
  run: ExecutionRunRecord;
  supersededRun: ExecutionRunRecord | undefined;
}): Promise<void> {
  const { context, command, run } = input;
  let turnChangeBound = false;
  try {
    if (input.supersededRun !== undefined) {
      await context.joinRun(input.supersededRun.runId);
    }
    if (context.getRunSignal(run.runId)?.aborted) {
      await finalizeAbortedRun(context, command.sessionId, run.runId);
      return;
    }
    // Host queues turns (ADR 0051); queued-turn rows are already persisted.
    // A continuation has no user text: like the Pi path, it writes no row.
    const continuation = command.input.source === 'continuation';
    let userMessageId: string | undefined;
    if (command.input.source === 'queued-turn' || continuation) {
      userMessageId = command.input.clientMessageId?.trim() || undefined;
    } else {
      userMessageId = command.input.clientMessageId?.trim() || randomUUID();
      await context.recordUserPrompt(command.sessionId, {
        ...command.input,
        clientMessageId: userMessageId,
      });
    }
    context.beginTurnChangeRun?.({
      sessionId: command.sessionId,
      userMessageId: userMessageId ?? null,
      runId: run.runId,
      source: 'prompt',
    });
    turnChangeBound = true;
    const liveSession = await context.activateSessionRuntime(
      command.sessionId,
      run.runId,
      context.getRunSignal(run.runId),
      userMessageId,
    );
    if (context.getRunSignal(run.runId)?.aborted) {
      await finalizeAbortedRun(context, command.sessionId, run.runId);
      return;
    }
    context.updateRunPhase(run.runId, 'connecting-model', 'Connecting to agent');
    const outcome = await liveSession.prompt(buildExternalAgentPrompt(command.input));
    const applied = await applyAgentPromptOutcome({
      context,
      sessionId: command.sessionId,
      runId: run.runId,
      outcome,
    });
    if (applied !== 'completed' || outcome.status !== 'completed') {
      return;
    }
    try {
      await context.touchSession(command.sessionId, command.input.text);
    } catch (error) {
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `session index touch failed: ${formatError(error)}`,
      });
    }
    await context.terminateRun(command.sessionId, run.runId, 'completed', undefined, undefined, {
      agentStopReason: outcome.stopReason,
    });
  } catch (error) {
    if (context.getRunSignal(run.runId)?.aborted) {
      await finalizeAbortedRun(context, command.sessionId, run.runId);
      return;
    }
    const failure = createUnknownAgentFailure(formatError(error));
    await persistHostRuntimeFailure({
      context,
      sessionId: command.sessionId,
      runId: run.runId,
      failure,
    });
    await context.terminateRun(command.sessionId, run.runId, 'failed', undefined, failure.message, {
      failure,
    });
  } finally {
    if (turnChangeBound) {
      context.endTurnChangeRun?.(run.runId);
    }
  }
}
