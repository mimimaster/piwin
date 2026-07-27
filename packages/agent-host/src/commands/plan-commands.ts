/**
 * Host IPC handlers: plan.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import {
  applyPlanStatus,
  applyPlanStepUpdate,
  clearSessionPlan,
  getSessionRecord,
  loadSessionPlan,
  saveSessionPlan,
  validateSessionPlan,
} from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import {
  getPiwinRoot,
  getPiwinSessionIndexPath,
  getPiwinSessionPlanPath,
} from '../paths.js';
import type { HostCommandContext } from './host-command-context.js';


const TYPES = new Set<HostCommand['type']>([
  'plan/get',
  'plan/set',
  'plan/clear',
  'plan/approve',
  'plan/update-step',
  'plan/set-status',
]);

export function isPlanCommand(
  command: HostCommand,
): boolean {
  return TYPES.has(command.type);
}

export async function handlePlanCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
        case 'plan/get': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
          const plan = await loadSessionPlan(planPath);
          return ok(requestId, 'plan/get', { sessionId: command.sessionId, plan });
        }
        case 'plan/set': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const existing = await getSessionRecord(
            getPiwinSessionIndexPath(rootDir),
            command.sessionId,
          );
          if (!existing) {
            return fail(requestId, 'plan/set', `Unknown session: ${command.sessionId}`);
          }
          const validated = validateSessionPlan(command.plan);
          if (!validated.ok) {
            return fail(
              requestId,
              'plan/set',
              validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
            );
          }
          const now = new Date().toISOString();
          const previous = await loadSessionPlan(
            getPiwinSessionPlanPath(rootDir, command.sessionId),
          );
          const plan = {
            ...validated.plan,
            sessionId: command.sessionId,
            projectPath: existing.projectPath,
            id: previous?.id ?? validated.plan.id,
            createdAt: previous?.createdAt ?? validated.plan.createdAt ?? now,
            updatedAt: now,
            revision: previous ? previous.revision + 1 : validated.plan.revision,
          };
          await saveSessionPlan(getPiwinSessionPlanPath(rootDir, command.sessionId), plan);
          context.push({ type: 'plan/updated', sessionId: command.sessionId, plan });
          return ok(requestId, 'plan/set', { plan });
        }
        case 'plan/clear': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          await clearSessionPlan(getPiwinSessionPlanPath(rootDir, command.sessionId));
          context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: null });
          return ok(requestId, 'plan/clear', { sessionId: command.sessionId });
        }
        case 'plan/approve': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
          const plan = await loadSessionPlan(planPath);
          if (!plan) {
            return fail(requestId, 'plan/approve', 'No plan for session');
          }
          if (plan.status !== 'draft' && plan.status !== 'approved') {
            return fail(
              requestId,
              'plan/approve',
              `Cannot approve plan in status ${plan.status}`,
            );
          }
          const approved = {
            ...plan,
            status: 'approved' as const,
            revision: plan.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          await saveSessionPlan(planPath, approved);
          context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: approved });
          return ok(requestId, 'plan/approve', { plan: approved });
        }
        case 'plan/update-step': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
          const plan = await loadSessionPlan(planPath);
          if (!plan) {
            return fail(requestId, 'plan/update-step', 'No plan for session');
          }
          const result = applyPlanStepUpdate({
            plan,
            stepId: command.stepId,
            status: command.status,
            ...(typeof command.detail === 'string' ? { detail: command.detail } : {}),
          });
          if (!result.ok) {
            return fail(requestId, 'plan/update-step', result.error);
          }
          await saveSessionPlan(planPath, result.plan);
          context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: result.plan });
          if (result.plan.status !== plan.status) {
            context.push({
              type: 'host/log',
              level: 'info',
              message: `plan ${command.sessionId} status ${plan.status} → ${result.plan.status}`,
            });
          }
          return ok(requestId, 'plan/update-step', { plan: result.plan });
        }
        case 'plan/set-status': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
          const plan = await loadSessionPlan(planPath);
          if (!plan) {
            return fail(requestId, 'plan/set-status', 'No plan for session');
          }
          const result = applyPlanStatus({ plan, status: command.status });
          if (!result.ok) {
            return fail(requestId, 'plan/set-status', result.error);
          }
          await saveSessionPlan(planPath, result.plan);
          context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: result.plan });
          return ok(requestId, 'plan/set-status', { plan: result.plan });
        }

    default:
      return null;
  }
}
