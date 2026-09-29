/**
 * Detached turn execution for external agent sessions (ADR 0082).
 *
 * Shares admission, Run registration and terminalization with the Pi path in
 * `session-prompt-command.ts`, but skips every Pi-only preparation step:
 * skills, plan/orchestration contracts, product history injection, model
 * runtime replacement and delegation. Grok receives the user's text verbatim
 * (plus `@` file refs), exactly as it would from its own TUI.
 */

import type { ExecutionRunRecord } from '@piwin/contracts';
import { createUnknownAgentFailure, formatError } from '@piwin/contracts';
import { randomUUID } from 'node:crypto';
import type { SessionLiveContext } from './session-live-context.js';
import type { PromptCommand } from './prompt-preparation.js';
import { finalizeAbortedRun } from './run-control-commands.js';
import { applyAgentPromptOutcome, persistHostRuntimeFailure } from './session-turn-outcome.js';

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
    let userMessageId: string | undefined;
    if (command.input.source === 'queued-turn') {
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
    context.updateRunPhase(run.runId, 'connecting-model', 'Connecting to Grok');
    const outcome = await liveSession.prompt({
      text: command.input.text,
      ...(command.input.contextRefs !== undefined ? { contextRefs: command.input.contextRefs } : {}),
    });
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
