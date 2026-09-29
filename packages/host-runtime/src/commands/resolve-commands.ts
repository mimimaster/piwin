/**
 * Host IPC handlers: resolve.
 */
import type { HostCommand, HostResponse, PermissionDecision } from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';
import { GrokBackendService } from '../grok/grok-backend-service.js';

const validateBackendPermissionOption = GrokBackendService.validateBackendOption;

const TYPES = new Set<HostCommand['type']>([
  'permission/resolve',
  'permission/pending-list',
  'extension/ui_resolve',
  'extension/ui_surface_get',
]);

export function isResolveCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleResolveCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
    case 'permission/resolve': {
      const pending = context.pendingPermissions.get(command.requestId);
      if (!pending) {
        return fail(
          requestId,
          'permission/resolve',
          `Unknown permission request: ${command.requestId}`,
          {
            code: 'ticket-consumed',
            data: { requestId: command.requestId },
          },
        );
      }
      // ADR 0082: external agent requests carry their own options. Validate
      // the chosen id and hand it back verbatim; piwin remembered scopes are
      // never applied to another agent's permission model.
      if (pending.context?.backendOptions !== undefined || command.backendOptionId !== undefined) {
        const problem = validateBackendPermissionOption(pending, command.decision, command.backendOptionId);
        if (problem !== undefined) {
          return fail(requestId, 'permission/resolve', problem, { code: problem });
        }
        if (command.backendOptionId !== undefined) {
          (pending as { backendOptionId?: string }).backendOptionId = command.backendOptionId;
        }
        pending.resolve(command.decision);
        context.pendingPermissions.delete(command.requestId);
        return ok(requestId, 'permission/resolve', {
          requestId: command.requestId,
          decision: command.decision,
        });
      }
      if (command.decision === 'allow' && command.rememberScope === 'project') {
        // General sessions have no project remembered permissions.
        const projectPath = pending.projectPath?.trim();
        if (projectPath) {
          await context.rememberProjectPermission(
            pending.sessionId,
            pending.action,
            pending.detail,
            command.rememberScope,
            projectPath,
          );
        }
        // If no project path, silently treat as once (still allow this turn).
      }
      // ADR 0024 §4: session-scoped allow (in-memory, no persistence).
      if (command.decision === 'allow' && command.rememberScope === 'session') {
        context.rememberSessionPermission(
          pending.sessionId,
          pending.action,
          pending.detail,
          pending.sessionGrant,
        );
      }
      pending.resolve(command.decision);
      context.pendingPermissions.delete(command.requestId);
      const resolveData: {
        requestId: string;
        decision: PermissionDecision;
        rememberScope?: 'once' | 'session' | 'project';
      } = {
        requestId: command.requestId,
        decision: command.decision,
      };
      if (command.rememberScope) {
        resolveData.rememberScope = command.rememberScope;
      }
      return ok(requestId, 'permission/resolve', resolveData);
    }
    case 'permission/pending-list': {
      const permissions: Array<{
        requestId: string;
        sessionId: string;
        action: string;
        detail: string;
        defaultDecision: PermissionDecision;
        context?: import('@piwin/contracts').PermissionRequestContext;
        runId?: string;
      }> = [];
      for (const [pendingRequestId, pending] of context.pendingPermissions.entries()) {
        if (pending.sessionId.length === 0) {
          continue;
        }
        permissions.push({
          requestId: pendingRequestId,
          sessionId: pending.sessionId,
          action: pending.action,
          detail: pending.detail,
          defaultDecision: pending.defaultDecision ?? 'ask',
          ...(pending.context ? { context: pending.context } : {}),
          ...(pending.runId ? { runId: pending.runId } : {}),
        });
      }
      return ok(requestId, 'permission/pending-list', { permissions });
    }
    case 'extension/ui_resolve': {
      const pending = context.pendingExtensionUi.get(command.requestId);
      if (!pending) {
        return fail(
          requestId,
          'extension/ui_resolve',
          `Unknown extension UI request: ${command.requestId}`,
          {
            code: 'ticket-consumed',
            data: { requestId: command.requestId },
          },
        );
      }
      context.pendingExtensionUi.delete(command.requestId);
      if (pending.kind === 'confirm') {
        pending.resolve({
          kind: 'confirm',
          confirmed: command.confirmed === true && command.cancelled !== true,
        });
      } else if (pending.kind === 'select') {
        if (command.cancelled === true || command.value === undefined) {
          pending.resolve({ kind: 'select', cancelled: true });
        } else {
          pending.resolve({ kind: 'select', value: command.value });
        }
      } else if (command.cancelled === true || command.value === undefined) {
        pending.resolve({ kind: 'input', cancelled: true });
      } else {
        pending.resolve({ kind: 'input', value: command.value });
      }
      return ok(requestId, 'extension/ui_resolve', {
        requestId: command.requestId,
        ok: true,
      });
    }
    case 'extension/ui_surface_get':
      return ok(
        requestId,
        'extension/ui_surface_get',
        context.getExtensionUiSurface?.(command.sessionId) ?? {
          sessionId: command.sessionId,
          statuses: [],
          widgets: [],
        },
      );
    default:
      return null;
  }
}
