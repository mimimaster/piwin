import type { MockHostBackend } from './host-client-mock.js';
import type {
  HostCommand,
  HostResponse,
  ModelRef,
  WalkthroughArtifact,
} from '@piwin/contracts';

export async function handleMockOpsCommands(
  host: MockHostBackend,
  command: HostCommand,
  id: string,
): Promise<HostResponse | null> {
  switch (command.type) {
      case 'session/list-children': {
        const sessions = host.childIndex?.get(command.parentSessionId) ?? [];
        return {
          id,
          type: 'response',
          command: 'session/list-children',
          success: true,
          data: { parentSessionId: command.parentSessionId, sessions, invocations: [] },
        };
      }
      case 'subagent/continue':
        return {
          id,
          type: 'response',
          command: 'subagent/continue',
          success: true,
          data: {
            runId: `mock-subagent-continuation-${Date.now()}`,
            childSessionId: command.childSessionId,
            acceptedAt: new Date().toISOString(),
          },
        };
      case 'subagent/worktree-action':
        return {
          id,
          type: 'response',
          command: 'subagent/worktree-action',
          success: true,
          data: {
            childSessionId: command.childSessionId,
            action: command.action,
            integrationStatus:
              command.action === 'apply'
                ? 'applied'
                : command.action === 'discard'
                  ? 'discarded'
                  : 'retained',
          },
        };
      case 'plan/get': {
        const plan = host.plans.get(command.sessionId) ?? null;
        return {
          id,
          type: 'response',
          command: 'plan/get',
          success: true,
          data: { sessionId: command.sessionId, plan },
        };
      }
      case 'plan/set': {
        const current = host.plans.get(command.sessionId);
        const expectationMatches =
          command.expected === null
            ? current === undefined
            : current !== undefined &&
              current.id === command.expected.planId &&
              current.revision === command.expected.revision;
        if (!expectationMatches) {
          return {
            id,
            type: 'response',
            command: 'plan/set',
            success: false,
            error:
              current === undefined
                ? 'plan missing for expected update'
                : `plan revision mismatch: expected ${
                    command.expected === null ? 'absent' : command.expected.revision
                  } but session has ${current.revision}`,
          };
        }
        const plan = {
          ...command.plan,
          id: current?.id ?? command.plan.id,
          revision: current?.revision === undefined ? 0 : current.revision + 1,
          ...(current?.execution === undefined ? {} : { execution: current.execution }),
        };
        host.plans.set(command.sessionId, plan);
        host.emitPush({ type: 'plan/updated', sessionId: command.sessionId, plan });
        return {
          id,
          type: 'response',
          command: 'plan/set',
          success: true,
          data: { plan },
        };
      }
      case 'plan/clear': {
        const current = host.plans.get(command.sessionId);
        if (
          current === undefined ||
          current.id !== command.expected.planId ||
          current.revision !== command.expected.revision
        ) {
          return {
            id,
            type: 'response',
            command: 'plan/clear',
            success: false,
            error: current === undefined ? 'plan missing' : 'plan revision mismatch',
          };
        }
        host.plans.delete(command.sessionId);
        host.emitPush({ type: 'plan/updated', sessionId: command.sessionId, plan: null });
        return {
          id,
          type: 'response',
          command: 'plan/clear',
          success: true,
          data: { sessionId: command.sessionId },
        };
      }
      case 'plan/approve': {
        const plan = host.plans.get(command.sessionId);
        if (!plan) {
          return {
            id,
            type: 'response',
            command: 'plan/approve',
            success: false,
            error: 'No plan for session',
          };
        }
        const approved = {
          ...plan,
          status: 'approved' as const,
          revision: plan.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        host.plans.set(command.sessionId, approved);
        host.emitPush({ type: 'plan/updated', sessionId: command.sessionId, plan: approved });
        return {
          id,
          type: 'response',
          command: 'plan/approve',
          success: true,
          data: { plan: approved },
        };
      }
      case 'plan/execute': {
        const plan = host.plans.get(command.request.sessionId);
        if (!plan) {
          return {
            id,
            type: 'response',
            command: 'plan/execute',
            success: false,
            error: 'No plan for session',
          };
        }
        if (plan.id !== command.request.planId) {
          return {
            id,
            type: 'response',
            command: 'plan/execute',
            success: false,
            error: `plan id mismatch: ${command.request.planId} vs ${plan.id}`,
          };
        }
        if (
          command.request.expectedRevision !== undefined &&
          plan.revision !== command.request.expectedRevision
        ) {
          return {
            id,
            type: 'response',
            command: 'plan/execute',
            success: false,
            error: `plan revision mismatch: ${command.request.expectedRevision} vs ${plan.revision}`,
          };
        }
        const canAtomicallyApproveDraft =
          plan.status === 'draft' && command.request.approveDraft === true;
        if (
          plan.status !== 'approved' &&
          plan.status !== 'executing' &&
          !canAtomicallyApproveDraft
        ) {
          return {
            id,
            type: 'response',
            command: 'plan/execute',
            success: false,
            error: `plan must be approved or atomically approved (current: ${plan.status})`,
          };
        }
        const executionState = {
          sessionId: command.request.sessionId,
          planId: plan.id,
          mode: command.request.mode,
          status: 'running' as const,
          childSessionIds: [] as string[],
        };
        const executing = {
          ...plan,
          status: 'executing' as const,
          execution: executionState,
          revision: plan.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        host.plans.set(command.request.sessionId, executing);
        host.emitPush({
          type: 'plan/updated',
          sessionId: command.request.sessionId,
          plan: executing,
        });
        host.emitPush({ type: 'plan/execution-updated', state: executionState });
        return {
          id,
          type: 'response',
          command: 'plan/execute',
          success: true,
          data: {
            sessionId: command.request.sessionId,
            planId: plan.id,
            mode: command.request.mode,
            status: 'running',
          },
        };
      }
      case 'plan/abort': {
        const plan = host.plans.get(command.sessionId);
        if (!plan) {
          return {
            id,
            type: 'response',
            command: 'plan/abort',
            success: false,
            error: 'No plan for session',
          };
        }
        const abortedState = {
          ...(plan.execution ?? {
            sessionId: command.sessionId,
            planId: plan.id,
            mode: 'inline' as const,
            status: 'aborted' as const,
            childSessionIds: [] as string[],
          }),
          status: 'aborted' as const,
          endedAt: new Date().toISOString(),
        };
        const aborted = {
          ...plan,
          status: 'abandoned' as const,
          execution: abortedState,
          revision: plan.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        host.plans.set(command.sessionId, aborted);
        host.emitPush({ type: 'plan/updated', sessionId: command.sessionId, plan: aborted });
        host.emitPush({ type: 'plan/execution-updated', state: abortedState });
        return {
          id,
          type: 'response',
          command: 'plan/abort',
          success: true,
          data: { sessionId: command.sessionId, planId: plan.id, status: 'aborted' },
        };
      }

      case 'plan/update-step': {
        const plan = host.plans.get(command.sessionId);
        if (!plan) {
          return {
            id,
            type: 'response',
            command: 'plan/update-step',
            success: false,
            error: 'No plan for session',
          };
        }
        const steps = plan.steps.map((step) => {
          if (step.id !== command.stepId) {
            if (command.status === 'active' && step.status === 'active') {
              return { ...step, status: 'pending' as const };
            }
            return step;
          }
          const next = { ...step, status: command.status };
          if (typeof command.detail === 'string' && command.detail) {
            next.detail = command.detail.slice(0, 500);
          }
          return next;
        });
        let status = plan.status;
        if (status === 'approved' && (command.status === 'active' || command.status === 'done')) {
          status = 'executing';
        }
        if (
          steps.length > 0 &&
          steps.every((step) => step.status === 'done' || step.status === 'skipped')
        ) {
          status = 'done';
        }
        const updated = {
          ...plan,
          steps,
          status,
          revision: plan.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        host.plans.set(command.sessionId, updated);
        host.emitPush({ type: 'plan/updated', sessionId: command.sessionId, plan: updated });
        return {
          id,
          type: 'response',
          command: 'plan/update-step',
          success: true,
          data: { plan: updated },
        };
      }
      case 'plan/set-status': {
        const plan = host.plans.get(command.sessionId);
        if (!plan) {
          return {
            id,
            type: 'response',
            command: 'plan/set-status',
            success: false,
            error: 'No plan for session',
          };
        }
        const updated = {
          ...plan,
          status: command.status,
          revision: plan.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        host.plans.set(command.sessionId, updated);
        host.emitPush({ type: 'plan/updated', sessionId: command.sessionId, plan: updated });
        return {
          id,
          type: 'response',
          command: 'plan/set-status',
          success: true,
          data: { plan: updated },
        };
      }
      case 'cron/list':
        return {
          id,
          type: 'response',
          command: 'cron/list',
          success: true,
          data: { version: 1, jobs: host.mockCronJobs },
        };
      case 'cron/upsert': {
        const job = command.job;
        const index = host.mockCronJobs.findIndex((item) => item.id === job.id);
        if (index === -1) host.mockCronJobs.push(job);
        else host.mockCronJobs[index] = job;
        return { id, type: 'response', command: 'cron/upsert', success: true, data: { job } };
      }
      case 'cron/delete': {
        host.mockCronJobs = host.mockCronJobs.filter((item) => item.id !== command.jobId);
        return {
          id,
          type: 'response',
          command: 'cron/delete',
          success: true,
          data: { deleted: true },
        };
      }
      case 'cron/run': {
        const job = host.mockCronJobs.find((item) => item.id === command.jobId);
        if (!job) {
          return {
            id,
            type: 'response',
            command: 'cron/run',
            success: false,
            error: `unknown job ${command.jobId}`,
          };
        }
        const automation = host.mockConfig.automation;
        if (automation?.enabled !== true) {
          return {
            id,
            type: 'response',
            command: 'cron/run',
            success: false,
            error: 'automation disabled (config.automation.enabled)',
          };
        }
        if (automation?.cronEnabled !== true) {
          return {
            id,
            type: 'response',
            command: 'cron/run',
            success: false,
            error: 'cron disabled (config.automation.cronEnabled)',
          };
        }
        if (job.enabled !== true) {
          return {
            id,
            type: 'response',
            command: 'cron/run',
            success: false,
            error: `job ${job.id} is disabled`,
          };
        }
        job.lastRunAt = new Date().toISOString();
        job.lastStatus = 'ok';
        host.emitPush({
          type: 'automation/cron_finished',
          jobId: job.id,
          ok: true,
          message: 'mock run',
        });
        return {
          id,
          type: 'response',
          command: 'cron/run',
          success: true,
          data: { ok: true, message: 'mock run' },
        };
      }
      case 'hooks/list':
        return {
          id,
          type: 'response',
          command: 'hooks/list',
          success: true,
          data: { version: 1, hooks: host.mockHooks },
        };
      case 'hooks/set': {
        host.mockHooks = command.hooks;
        return {
          id,
          type: 'response',
          command: 'hooks/set',
          success: true,
          data: { version: 1, hooks: host.mockHooks },
        };
      }
      case 'todo/get':
        return {
          id,
          type: 'response',
          command: 'todo/get',
          success: true,
          data: {
            sessionId: command.sessionId,
            items: [],
            updatedAt: new Date().toISOString(),
            revision: 'empty',
          },
        };
      case 'todo/set':
        return {
          id,
          type: 'response',
          command: 'todo/set',
          success: true,
          data: {
            sessionId: command.sessionId,
            items: command.items,
            updatedAt: new Date().toISOString(),
            revision: 'empty',
          },
        };

      // --- Browser session commands (ADR 0020 §6) ---------------------------
      case 'walkthrough/list': {
        // Deterministic mock: synthesize a ready artifact for the first
        // assistant transcript message when one exists, so the doc view and
        // card have something to render in mock/e2e mode.
        const session = host.sessions.get(command.sessionId);
        const artifacts: WalkthroughArtifact[] = [];
        if (session) {
          for (const msg of session.transcript) {
            if (msg.role !== 'assistant') continue;
            const model: ModelRef = {
              protocol: 'openai-compatible',
              providerId: 'mock',
              modelId: 'mock-walkthrough',
            };
            artifacts.push({
              version: 1,
              id: `wt-${msg.id}`,
              sessionId: command.sessionId,
              messageId: msg.id,
              mode: 'default',
              model,
              sourceHash: 'mock-source-hash',
              createdAt: msg.createdAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              status: 'ready',
              markdown: `# Walkthrough\n\n## Summary\n\nMock walkthrough for message ${msg.id}.\n`,
              generatedAt: new Date().toISOString(),
            });
            break;
          }
        }
        return {
          id,
          type: 'response',
          command: 'walkthrough/list',
          success: true,
          data: { sessionId: command.sessionId, artifacts },
        };
      }
      case 'walkthrough/generate': {
        // No provider configured → model-unavailable (spec §5.2 error mapping).
        if (host.mockConfig.providers.length === 0) {
          return {
            id,
            type: 'response',
            command: 'walkthrough/generate',
            success: false,
            error: 'model-unavailable',
          };
        }
        const generationId = crypto.randomUUID();
        const now = new Date().toISOString();
        const model: ModelRef = {
          protocol: host.mockConfig.providers[0]?.protocol ?? 'openai-compatible',
          providerId: host.mockConfig.providers[0]?.id ?? 'mock',
          modelId: host.mockConfig.providers[0]?.models[0]?.id ?? 'mock-walkthrough',
        };
        // Publish `generating` immediately so the UI shows the loading state.
        const generatingArtifact: WalkthroughArtifact = {
          version: 1,
          id: `wt-${command.messageId}`,
          sessionId: command.sessionId,
          messageId: command.messageId,
          ...(command.runId ? { runId: command.runId } : {}),
          mode: 'default',
          model,
          sourceHash: 'mock-source-hash',
          createdAt: now,
          updatedAt: now,
          status: 'generating',
          generationId,
        };
        host.emitPush({
          type: 'walkthrough/updated',
          sessionId: command.sessionId,
          artifact: generatingArtifact,
        });
        // Delayed `ready` push simulates async generation completion.
        const sessionId = command.sessionId;
        const messageId = command.messageId;
        const readyModel = model;
        const emitPush = host.emitPush;
        setTimeout(() => {
          const readyNow = new Date().toISOString();
          const readyArtifact: WalkthroughArtifact = {
            version: 1,
            id: `wt-${messageId}`,
            sessionId,
            messageId,
            mode: 'default',
            model: readyModel,
            sourceHash: 'mock-source-hash',
            createdAt: readyNow,
            updatedAt: readyNow,
            status: 'ready',
            markdown: `# Walkthrough\n\n## Summary\n\nGenerated walkthrough for message ${messageId}.\n`,
            generatedAt: readyNow,
          };
          emitPush({ type: 'walkthrough/updated', sessionId, artifact: readyArtifact });
        }, 50);
        return {
          id,
          type: 'response',
          command: 'walkthrough/generate',
          success: true,
          data: {
            sessionId: command.sessionId,
            messageId: command.messageId,
            generationId,
            status: 'generating',
          },
        };
      }
      case 'walkthrough/cancel': {
        const cancelNow = new Date().toISOString();
        const cancelledArtifact: WalkthroughArtifact = {
          version: 1,
          id: `wt-${command.messageId}`,
          sessionId: command.sessionId,
          messageId: command.messageId,
          mode: 'default',
          sourceHash: 'mock-source-hash',
          createdAt: cancelNow,
          updatedAt: cancelNow,
          status: 'error',
          error: { code: 'cancelled', message: 'Walkthrough generation was cancelled.' },
          generatedAt: cancelNow,
        };
        host.emitPush({
          type: 'walkthrough/updated',
          sessionId: command.sessionId,
          artifact: cancelledArtifact,
        });
        return {
          id,
          type: 'response',
          command: 'walkthrough/cancel',
          success: true,
          data: {
            sessionId: command.sessionId,
            messageId: command.messageId,
            ...(command.generationId !== undefined ? { generationId: command.generationId } : {}),
            status: 'cancelled',
          },
        };
      }

    default:
      return null;
  }
}
