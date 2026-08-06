/**
 * CE-WORKER: WorkerTaskRunner — SubagentTaskRunner adapter for the worker backend.
 *
 * Phase 3 runtime refactor: implements the SubagentTaskRunner interface from
 * contracts using the AgentWorkerSupervisor. Reports processIsolation=true.
 *
 * SC-06: Product concurrency above one requires processIsolation=true.
 * SC-07: Isolation is a backend fact; callers do not send a process-policy switch.
 *
 * The runner receives a frozen SubagentTaskRunInput and does not re-read
 * Settings, project trust, profiles, or prompt attachments.
 */

import type {
  AgentEvent,
  SubagentTaskRunner,
  SubagentTaskRunInput,
  SubagentTaskRunOutput,
} from '@piwin/contracts';
import type { AgentWorkerSupervisor } from './agent-worker-supervisor.js';
import type { RpcSdkWorkerClient } from './rpc-sdk-worker-client.js';
import { assertValidBackendSessionBlueprint } from './backends/pi-session-backend.js';
import { formatError } from '@piwin/contracts';
import {
  projectBackendBlueprintForWorker,
  type SerializableBlueprint,
} from './rpc/serializable-blueprint.js';
import type { SerializableProviderRuntime } from './rpc/serializable-blueprint.js';

/** Options for the worker task runner. */
export type WorkerTaskRunnerOptions = {
  supervisor: AgentWorkerSupervisor;
};

/**
 * WorkerTaskRunner: implements SubagentTaskRunner using the worker backend.
 *
 * This is the adapter that makes the worker supervisor usable by the
 * SubagentOrchestrator. It reports processIsolation=true, enabling
 * parallel subagent execution with real process isolation.
 */
export class WorkerTaskRunner implements SubagentTaskRunner {
  private readonly supervisor: AgentWorkerSupervisor;

  constructor(options: WorkerTaskRunnerOptions) {
    this.supervisor = options.supervisor;
  }

  readonly capabilities = {
    processIsolation: true,
  };

  async runTask(
    input: SubagentTaskRunInput,
    signal: AbortSignal,
  ): Promise<SubagentTaskRunOutput> {
    const { workspaceLease, childSessionId, runtimeGenerationId } = input;
    let client: RpcSdkWorkerClient | undefined;
    let workerSessionId: string | undefined;
    let abortListener: (() => void) | undefined;
    let onWorkerEvent: ((sessionId: string, event: AgentEvent) => void) | undefined;

    // The contract is non-optional. Keep this runtime guard because older
    // orchestrator callers can still arrive through the transitional path;
    // never replace a missing blueprint with an empty capability envelope.
    if (!input.sessionBlueprint) {
      throw new Error(
        'WorkerTaskRunner requires a compiled BackendSessionBlueprint; transition wiring is incomplete',
      );
    }
    assertValidBackendSessionBlueprint(input.sessionBlueprint);

    // The worker must not resolve secrets itself (Phase 7 plan §6). A
    // provider-backed task requires a non-empty provider envelope; passing
    // `providers: []` would leave the worker unable to construct model
    // clients and is forbidden.
    if (!input.providers || input.providers.length === 0) {
      throw new Error(
        'WorkerTaskRunner requires a provider envelope; providers: [] is forbidden for a provider-backed task',
      );
    }

    try {
      const blueprint: SerializableBlueprint = projectBackendBlueprintForWorker(
        input.sessionBlueprint,
      );
      // Acquire a worker for this child session.
      client = await this.supervisor.acquireWorker(
        childSessionId,
        runtimeGenerationId,
      );
      let summaryText = '';
      onWorkerEvent = (sessionId: string, event: AgentEvent): void => {
        if (sessionId !== childSessionId) return;
        if (event.type === 'message/text_delta') {
          summaryText += event.delta;
        } else if (event.type === 'message/text_snapshot') {
          summaryText = event.text;
        }
      };
      const eventClient = client as unknown as {
        on?: (eventName: string, listener: unknown) => void;
      };
      eventClient.on?.('event', onWorkerEvent);

      // Project the exact cross-package blueprint into the current worker
      // protocol shape without letting the worker read product settings.
      // Create a session in the worker. createSession takes the product
      // session ID but returns its own internal session ID, which must be
      // used for subsequent prompt/abort calls.
      const sessionResult = await client.createSession({
        productSessionId: childSessionId,
        blueprint,
        providers: input.providers as SerializableProviderRuntime[],
      });
      workerSessionId = sessionResult.sessionId;

      // Send the prompt.
      const promptOptions: {
        images?: Array<{ mimeType: string; dataBase64: string }>;
        streamingBehavior?: 'steer' | 'followUp';
        thinkingLevel?: string;
        model?: { providerId: string; modelId: string };
        runId?: string;
      } = {};

      if (input.preparedPrompt.images && input.preparedPrompt.images.length > 0) {
        promptOptions.images = input.preparedPrompt.images.map((img) => ({
          mimeType: img.mimeType,
          dataBase64: img.dataBase64,
        }));
      }

      if (input.preparedPrompt.streamingBehavior) {
        promptOptions.streamingBehavior = input.preparedPrompt.streamingBehavior;
      }

      if (input.preparedPrompt.thinkingLevel) {
        promptOptions.thinkingLevel = input.preparedPrompt.thinkingLevel;
      }

      if (input.preparedPrompt.model) {
        promptOptions.model = {
          providerId: input.preparedPrompt.model.providerId,
          modelId: input.preparedPrompt.model.modelId,
        };
      }
      promptOptions.runId = input.taskRunId;

      // Handle cancellation: abort the prompt if signal fires.
      const abortPromise = new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        abortListener = () => {
          void client?.abort(workerSessionId ?? '').catch(() => {});
          reject(new Error('aborted'));
        };
        signal.addEventListener('abort', abortListener, { once: true });
      });

      // Send the prompt and wait for completion.
      await Promise.race([
        client.prompt(workerSessionId, input.preparedPrompt.text, promptOptions),
        abortPromise,
      ]);

      // Determine integration status based on workspace lease.
      const integrationStatus =
        workspaceLease.mode === 'worktree' ? 'pending' : 'not-requested';

      return {
        executionStatus: 'completed',
        summaryStatus: summaryText.trim() ? 'pending' : 'not-requested',
        integrationStatus,
        childSessionId,
        ...(summaryText.trim() ? { summaryPreview: truncateSummary(summaryText) } : {}),
      };
    } catch (error) {
      const message = formatError(error);

      // Check if this was an abort.
      if (signal.aborted || message === 'aborted') {
        return {
          executionStatus: 'cancelled',
          summaryStatus: 'not-requested',
          integrationStatus: 'not-requested',
          childSessionId,
        };
      }

      return {
        executionStatus: 'failed',
        summaryStatus: 'not-requested',
        integrationStatus: 'not-requested',
        childSessionId,
        error: message,
      };
    } finally {
      if (abortListener) {
        signal.removeEventListener('abort', abortListener);
      }
      if (client && onWorkerEvent) {
        const eventClient = client as unknown as {
          off?: (eventName: string, listener: unknown) => void;
        };
        eventClient.off?.('event', onWorkerEvent);
      }
      // Release the worker for this session/generation.
      await this.supervisor.releaseWorker(childSessionId, runtimeGenerationId).catch(() => {});
    }
  }
}

function truncateSummary(text: string): string {
  const normalized = text.trim();
  const maximumLength = 12000;
  return normalized.length > maximumLength
    ? `${normalized.slice(0, maximumLength)}\n[summary truncated]`
    : normalized;
}
