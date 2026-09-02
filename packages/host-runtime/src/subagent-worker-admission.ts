/**
 * Host-owned WorkerAdmissionPort: put a task-scoped worker on the residency
 * ledger before the supervisor starts a process.
 */

import type { WorkerAdmission, WorkerAdmissionPort } from '@piwin/agent-host';
import type { SessionRuntimeResidencyController } from './sessions/session-runtime-residency-controller.js';

export type SubagentWorkerAdmissionDeps = {
  refreshWorkerRssSample: () => Promise<void>;
  publishWaitingResourceWhileQueued: (runId: string) => Promise<void>;
  residencyController: SessionRuntimeResidencyController;
};

export function createSubagentWorkerAdmission(
  deps: SubagentWorkerAdmissionDeps,
): WorkerAdmissionPort {
  return {
    async begin(input): Promise<WorkerAdmission> {
      await deps.refreshWorkerRssSample();
      if (input.runId !== undefined) {
        void deps.publishWaitingResourceWhileQueued(input.runId);
      }
      const result = await deps.residencyController.beginActivation(
        input.sessionId,
        input.runtimeGenerationId,
        input.signal,
        { ephemeral: true },
      );
      if (!result.ok) {
        if (result.code === 'memory-pressure') {
          throw Object.assign(new Error(`runtime-memory-pressure: ${result.message}`), {
            code: 'runtime-memory-pressure',
          });
        }
        throw new Error('aborted');
      }
      return {
        commit: () => {
          deps.residencyController.commitActivation(input.sessionId, input.runtimeGenerationId);
        },
        release: () => {
          deps.residencyController.releaseEphemeral(input.sessionId, input.runtimeGenerationId);
        },
      };
    },
  };
}
