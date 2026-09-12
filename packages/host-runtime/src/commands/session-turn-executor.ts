/**
 * Detached model-turn execution. Admission and immediate acceptance stay in
 * session-prompt-command.ts; this module owns the single post-ack terminal path.
 */

import type { ExecutionRunRecord, ModelRef, ThinkingLevel } from '@piwin/contracts';
import { createUnknownAgentFailure, formatError } from '@piwin/contracts';
import { loadSessionPlan } from '@piwin/session';
import { createModelPromptAssembly } from '../model-context-assembly.js';
import { persistAndPushAssembly } from '../model-context-record.js';
import type { SessionLiveContext } from './session-live-context.js';
import {
  injectProductHistoryOnce,
  preparePromptInput,
  type PromptCommand,
} from './prompt-preparation.js';
import { injectBranchCalibrationOnce } from './branch-calibration.js';
import { finalizeAbortedRun } from './run-control-commands.js';
import { scheduleReplyWriterAfterRun } from './reply-writer-live.js';
import { applyAgentPromptOutcome, persistHostRuntimeFailure } from './session-turn-outcome.js';

export async function executeSessionTurn(input: {
  context: SessionLiveContext;
  command: PromptCommand;
  run: ExecutionRunRecord;
  conversationChat: boolean;
  persistedPlanIntent: 'writing-plans-skill' | 'plan-mode' | null;
  planPath: string | undefined;
  startingPlanRevision: number;
  previousModel: ModelRef | undefined;
  requiresModelRuntimeReplacement: boolean;
  desiredModel: ModelRef | undefined;
  desiredThinkingLevel: ThinkingLevel | undefined;
  supersededRun: ExecutionRunRecord | undefined;
  supersededCheckpointId: string | undefined;
}): Promise<void> {
  const { context, command, run } = input;
  let turnChangeBound = false;
  let executionLease: { release: () => void } | undefined;
  try {
    const runSignal = context.getRunSignal(run.runId);
    if (context.acquireExecutionLease && runSignal) {
      executionLease = await context.acquireExecutionLease({
        runId: run.runId,
        executionClass: 'foreground',
        signal: runSignal,
        onQueued: () => {
          context.updateRunPhase(run.runId, 'waiting-resource', 'execution-slot');
        },
      });
      if (runSignal.aborted) {
        await finalizeAbortedRun(context, command.sessionId, run.runId);
        return;
      }
    }
    if (!input.conversationChat) {
      const delegationMode = command.input.delegationMode === 'disabled' ? 'disabled' : 'auto';
      await context.prepareDelegationRuntime?.(command.sessionId, delegationMode);
      if (context.getRunSignal(run.runId)?.aborted) {
        await finalizeAbortedRun(context, command.sessionId, run.runId);
        return;
      }
    }
    // Model selection is independent from compaction. A source-generation
    // compact may be slow or fail, so it must not gate applying the requested
    // target model. The selected runtime owns its normal Pi compaction path.
    const assembly = createModelPromptAssembly();
    const { promptInput, userMessageId } = await preparePromptInput(
      context,
      command,
      run,
      assembly,
      input.conversationChat,
      {
        desiredModel: input.desiredModel,
        desiredThinkingLevel: input.desiredThinkingLevel,
      },
    );
    if (context.getRunSignal(run.runId)?.aborted) {
      await finalizeAbortedRun(context, command.sessionId, run.runId);
      return;
    }
    context.beginTurnChangeRun?.({
      sessionId: command.sessionId,
      userMessageId: userMessageId ?? null,
      runId: run.runId,
      source: command.input.source === 'resume' ? 'resume' : 'prompt',
    });
    turnChangeBound = true;

    if (input.requiresModelRuntimeReplacement) {
      try {
        // preparePromptInput has already persisted this user row. Exclude it
        // from the replacement seed because it will be sent as the live
        // prompt immediately after the new generation is activated.
        await context.replaceRuntimeForModel(command.sessionId, userMessageId);
      } catch (error) {
        if (input.previousModel === undefined) {
          context.sessionModels.delete(command.sessionId);
        } else {
          context.sessionModels.set(command.sessionId, input.previousModel);
        }
        throw error;
      }
      if (context.getRunSignal(run.runId)?.aborted) {
        await finalizeAbortedRun(context, command.sessionId, run.runId);
        return;
      }
    }

    if (input.supersededRun !== undefined) {
      await context.joinRun(input.supersededRun.runId);
      if (context.getRunSignal(run.runId)?.aborted) {
        await finalizeAbortedRun(context, command.sessionId, run.runId);
        return;
      }
    }

    const liveSession = await context.activateSessionRuntime(
      command.sessionId,
      run.runId,
      context.getRunSignal(run.runId),
      // The durable row id is generated during preparation when the caller
      // did not provide one. Exclude that exact row from a cold replay seed;
      // it is sent below as the live prompt and must not appear twice.
      userMessageId,
    );
    if (context.getRunSignal(run.runId)?.aborted) {
      await finalizeAbortedRun(context, command.sessionId, run.runId);
      return;
    }

    const historyBefore = promptInput.text;
    await injectProductHistoryOnce(context, command.sessionId, promptInput);
    if (promptInput.text !== historyBefore) {
      assembly.add({
        kind: 'product-history',
        label: 'Product history',
        trustOrigin: 'piwin',
        text: promptInput.text.slice(
          0,
          Math.max(0, promptInput.text.length - historyBefore.length),
        ),
      });
    }
    const calibrationBefore = promptInput.text;
    await injectBranchCalibrationOnce(context, command.sessionId, promptInput);
    if (promptInput.text !== calibrationBefore) {
      assembly.add({
        kind: 'runtime-observed',
        label: 'Branch calibration',
        trustOrigin: 'piwin',
        text: promptInput.text.slice(
          0,
          Math.max(0, promptInput.text.length - calibrationBefore.length),
        ),
      });
    }
    const summary = assembly.toSummary({
      sessionId: command.sessionId,
      runId: run.runId,
      requestClass: command.input.source === 'resume' ? 'pause-resume' : 'prompt',
      requestOrdinal: await context.nextModelRequestOrdinal(command.sessionId),
      ...(userMessageId === undefined ? {} : { userMessageId }),
    });
    await persistAndPushAssembly({
      ...(context.piwinRoot === undefined ? {} : { piwinRoot: context.piwinRoot }),
      summary,
      push: context.push,
    });
    if (context.getRunSignal(run.runId)?.aborted) {
      await finalizeAbortedRun(context, command.sessionId, run.runId);
      return;
    }

    // New user input replaces the paused task, not its transcript. Keep the
    // recovery point through validation/runtime preparation; retire it only
    // when the new turn is ready to reach the model.
    if (input.supersededCheckpointId !== undefined) {
      const cleared = await context.clearPauseCheckpoint(
        command.sessionId,
        input.supersededCheckpointId,
      );
      if (!cleared) {
        throw new Error('pause-checkpoint-mismatch: new prompt no longer owns the paused task');
      }
      if (context.getRunSignal(run.runId)?.aborted) {
        await finalizeAbortedRun(context, command.sessionId, run.runId);
        return;
      }
    }
    const outcome = await liveSession.prompt(promptInput);
    const applied = await applyAgentPromptOutcome({
      context,
      sessionId: command.sessionId,
      runId: run.runId,
      outcome,
    });
    if (applied !== 'completed' || outcome.status !== 'completed') {
      return;
    }

    let finalOutcome = outcome;
    if (context.settleParentSubagents) {
      const settled = await context.settleParentSubagents({
        sessionId: command.sessionId,
        parentRunId: run.runId,
        firstOutcome: outcome,
        liveSession,
      });
      if (settled.status === 'aborted') {
        await finalizeAbortedRun(context, command.sessionId, run.runId);
        return;
      }
      if (settled.status === 'failed') {
        await persistHostRuntimeFailure({
          context,
          sessionId: command.sessionId,
          runId: run.runId,
          failure: settled.failure,
        });
        await context.terminateRun(
          command.sessionId,
          run.runId,
          'failed',
          undefined,
          settled.failure.message,
          { failure: settled.failure },
        );
        return;
      }
      finalOutcome = settled.outcome;
    }

    if (input.planPath) {
      const completedPlan = await loadSessionPlan(input.planPath);
      if (
        !completedPlan ||
        completedPlan.revision <= input.startingPlanRevision ||
        (input.persistedPlanIntent === 'writing-plans-skill' &&
          (completedPlan.source !== 'skill' || completedPlan.skillId !== 'writing-plans'))
      ) {
        throw new Error(
          'plan-not-persisted: Plan mode and writing-plans must finish by creating or revising the durable SessionPlan with piwin_plan_create',
        );
      }
    }

    if (command.input.source !== 'resume') {
      try {
        await context.touchSession(command.sessionId, promptInput.text || command.input.text);
      } catch (error) {
        const message = formatError(error);
        context.push({
          type: 'host/log',
          level: 'warn',
          message: `session index touch failed: ${message}`,
        });
      }
    }
    await context.terminateRun(command.sessionId, run.runId, 'completed', undefined, undefined, {
      agentStopReason: finalOutcome.stopReason,
    });
    void scheduleReplyWriterAfterRun(context, {
      sessionId: command.sessionId,
      runId: run.runId,
    });
  } catch (error) {
    if (context.getRunSignal(run.runId)?.aborted) {
      await finalizeAbortedRun(context, command.sessionId, run.runId);
      return;
    }
    const message = formatError(error);
    const terminalCode =
      (error as { code?: string } | null)?.code === 'runtime-memory-pressure'
        ? ('runtime-memory-pressure' as const)
        : undefined;
    const failure = createUnknownAgentFailure(message);
    await persistHostRuntimeFailure({
      context,
      sessionId: command.sessionId,
      runId: run.runId,
      failure,
    });
    await context.terminateRun(
      command.sessionId,
      run.runId,
      'failed',
      terminalCode,
      failure.message,
      {
        failure,
      },
    );
  } finally {
    executionLease?.release();
    if (turnChangeBound) {
      context.endTurnChangeRun?.(run.runId);
    }
  }
}
