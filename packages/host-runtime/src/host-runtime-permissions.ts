/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { randomUUID } from 'node:crypto';
import {
  formatError,
  type PermissionDecision,
  type PermissionMode,
  type SubagentInvocationActivity,
} from '@piwin/contracts';
import { type ExtensionUiKind, type ExtensionUiResponse } from '@piwin/agent-host';
import { permissionResolvedPushes } from './permission-resolved-push.js';
import {
  addBashAllowRule,
  addFileWriteAllowRule,
  allowNetworkFetchHost,
  allowNetworkWebSearch,
  setProjectTrust,
} from '@piwin/project';

import { getPiwinProjectsPath, getPiwinRoot } from './paths.js';
import { buildPermissionRequestContext } from './permission-context.js';
import { SessionAllowlist } from './session-allowlist.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { extractBashCommandFromDetail } from './permission-bash-detail.js';
import { createCancelledExtensionUiResponse } from './extension-ui-cancel.js';
import { invocationActivityKey } from './subagent-orchestrator-batch.js';

/**
 * A child's approval is a Host push, not a worker event, so the invocation
 * card never learned it was blocked and kept saying "running bash". Mirror the
 * wait onto the invocation and restore the prior activity once it settles,
 * unless the child already moved on.
 */
function markSubagentPermissionWait(
  deps: HostRuntimeKernel,
  sessionId: string,
  action: string,
): (() => void) | undefined {
  const invocationId = deps.subagentSessionContexts.get(sessionId)?.invocationId;
  const orchestrator = deps.subagentOrchestrator;
  if (!invocationId || !orchestrator) return undefined;
  const previous = orchestrator.getRunningInvocationActivity(invocationId);
  const waiting: SubagentInvocationActivity = { kind: 'permission', action };
  const record = (activity: SubagentInvocationActivity): void => {
    void orchestrator.updateInvocationActivity(invocationId, activity).catch((error: unknown) => {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `subagent permission activity persistence failed: ${formatError(error)}`,
      });
    });
  };
  record(waiting);
  return () => {
    const current = orchestrator.getRunningInvocationActivity(invocationId);
    if (!current || invocationActivityKey(current) !== invocationActivityKey(waiting)) return;
    record(previous ?? { kind: 'thinking' });
  };
}

export async function trustProject(deps: HostRuntimeKernel, projectPath: string): Promise<unknown> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  return setProjectTrust(getPiwinProjectsPath(rootDir), projectPath, 'trusted');
}

/**
 * Emit a permission request to the UI and wait for permission/resolve.
 * Used by permission-aware tool registrations (web_search / web_fetch) during live sessions.
 */
export function requestPermission(
  deps: HostRuntimeKernel,
  input: {
    sessionId: string;
    projectPath?: string;
    action: string;
    detail: string;
    defaultDecision: PermissionDecision;
    signal?: AbortSignal;
  },
): Promise<PermissionDecision> {
  const requestId = randomUUID();
  const context = buildPermissionRequestContext(input.action, input.detail);
  return new Promise((resolve) => {
    const activeRun = deps.runRegistry.getForegroundRun(input.sessionId);
    const executionRunId = deps.runExecutionContext.getStore();
    const permissionRunId = executionRunId ?? activeRun?.runId;
    let settled = false;
    let published = false;
    let restoreSubagentActivity: (() => void) | undefined;
    const cleanup = (): void => {
      input.signal?.removeEventListener('abort', abortHandler);
    };
    const settle = (decision: PermissionDecision): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      deps.pendingPermissions.delete(requestId);
      restoreSubagentActivity?.();
      if (published) {
        for (const message of permissionResolvedPushes({
          sessionId: input.sessionId,
          requestId,
          decision,
          ...(permissionRunId ? { runId: permissionRunId } : {}),
        })) {
          deps.push(message);
        }
      }
      resolve(decision);
    };
    const abortHandler = (): void => {
      settle('deny');
    };
    const pendingPermission = {
      resolve: settle,
      sessionId: input.sessionId,
      ...(permissionRunId ? { runId: permissionRunId } : {}),
      ...(input.projectPath ? { projectPath: input.projectPath } : {}),
      action: input.action,
      detail: input.detail,
      defaultDecision: input.defaultDecision,
      cleanup,
    };
    deps.pendingPermissions.set(requestId, pendingPermission);
    if (input.signal?.aborted) {
      settle('deny');
      return;
    }
    input.signal?.addEventListener('abort', abortHandler, { once: true });
    published = true;
    restoreSubagentActivity = markSubagentPermissionWait(deps, input.sessionId, input.action);
    deps.push({
      type: 'permission/request',
      sessionId: input.sessionId,
      requestId,
      action: input.action,
      detail: input.detail,
      defaultDecision: input.defaultDecision,
      context,
      ...(permissionRunId ? { runId: permissionRunId } : {}),
    });
    deps.push({
      type: 'event',
      sessionId: input.sessionId,
      event: {
        type: 'permission/request',
        requestId,
        action: input.action,
        detail: input.detail,
        defaultDecision: input.defaultDecision,
        context,
        ...(permissionRunId ? { runId: permissionRunId } : {}),
      },
    });
  });
}

/**
 * Get or create the in-memory session allowlist (ADR 0024 §4).
 * Used by parent-owned bash/file registrations to check "Allow for session" approvals.
 */
export function getOrCreateSessionAllowlist(
  deps: HostRuntimeKernel,
  sessionId: string,
): SessionAllowlist {
  let al = deps.sessionAllowlists.get(sessionId);
  if (!al) {
    al = new SessionAllowlist();
    deps.sessionAllowlists.set(sessionId, al);
  }
  return al;
}

/**
 * Record a session-scoped allow (ADR 0024 §4). Called when the user picks
 * "Allow for session" on a permission prompt. Extracts the command or path
 * from the permission detail.
 */
export function rememberSessionPermission(
  deps: HostRuntimeKernel,
  sessionId: string,
  action: string,
  detail: string,
): void {
  const al = deps.getOrCreateSessionAllowlist(sessionId);
  // Bash detail format: `<reason>: <command>` — the command is after `: `.
  // File-write detail is the resolved absolute path.
  if (action === 'bash') {
    const colonIdx = detail.indexOf(': ');
    const command = colonIdx >= 0 ? detail.slice(colonIdx + 2) : detail;
    al.addBashCommand(command);
  } else if (action === 'file-write') {
    al.addFilePath(detail);
  }
  // Network and other actions: no session remember (use project or once).
}

export function clearSessionAllowlist(deps: HostRuntimeKernel, sessionId: string): void {
  deps.sessionAllowlists.delete(sessionId);
  deps.sessionPermissionOverrides.delete(sessionId);
}

export function setSessionPermissionOverride(
  deps: HostRuntimeKernel,
  sessionId: string,
  mode: PermissionMode,
): void {
  deps.sessionPermissionOverrides.set(sessionId, mode);
}

export function clearSessionPermissionOverride(deps: HostRuntimeKernel, sessionId: string): void {
  deps.sessionPermissionOverrides.delete(sessionId);
}

export function getSessionPermissionOverride(
  deps: HostRuntimeKernel,
  sessionId: string,
): PermissionMode | undefined {
  return deps.sessionPermissionOverrides.get(sessionId);
}

export function waitForPermission(
  deps: HostRuntimeKernel,
  requestId: string,
): Promise<PermissionDecision> {
  return new Promise((resolve) => {
    deps.pendingPermissions.set(requestId, {
      resolve,
      sessionId: '',
      action: '',
      detail: '',
    });
  });
}

/**
 * Bridge Pi ExtensionUIContext confirm/select/input to Desktop (D-EXT-04).
 */
export function requestExtensionUi(
  deps: HostRuntimeKernel,
  input: import('@piwin/agent-host').ExtensionUiRequest & { sessionId: string },
): Promise<import('@piwin/agent-host').ExtensionUiResponse> {
  return new Promise((resolve) => {
    deps.pendingExtensionUi.set(input.requestId, {
      resolve,
      kind: input.kind,
      sessionId: input.sessionId,
    });
    const pushMessage: {
      type: 'extension/ui_request';
      sessionId: string;
      requestId: string;
      kind: import('@piwin/agent-host').ExtensionUiKind;
      title: string;
      message?: string;
      options?: string[];
      placeholder?: string;
    } = {
      type: 'extension/ui_request',
      sessionId: input.sessionId,
      requestId: input.requestId,
      kind: input.kind,
      title: input.title,
    };
    if (input.message !== undefined) {
      pushMessage.message = input.message;
    }
    if (input.options !== undefined) {
      pushMessage.options = input.options;
    }
    if (input.placeholder !== undefined) {
      pushMessage.placeholder = input.placeholder;
    }
    deps.push(pushMessage);
  });
}

/**
 * Resolve every Extension UI wait owned by a session.
 *
 * Pi's Extension UI methods are promise-based and are not necessarily
 * connected to the foreground run AbortSignal. Stop therefore has to
 * explicitly settle these promises before aborting the live session.
 */
export function settlePendingExtensionUiForSession(
  deps: HostRuntimeKernel,
  sessionId: string,
): void {
  for (const [requestId, pending] of deps.pendingExtensionUi.entries()) {
    if (pending.sessionId !== sessionId) {
      continue;
    }
    pending.resolve(createCancelledExtensionUiResponse(pending.kind));
    deps.pendingExtensionUi.delete(requestId);
  }
}

export async function rememberProjectPermission(
  deps: HostRuntimeKernel,
  sessionId: string,
  action: string,
  detail: string,
  scope: 'project' = 'project',
  pendingProjectPath?: string,
): Promise<void> {
  const projectPath = pendingProjectPath ?? deps.sessionProjects.get(sessionId);
  // Empty path / general workspace path = no project allowlist to mutate.
  if (!projectPath || projectPath.trim().length === 0) {
    return;
  }
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const projectsFile = getPiwinProjectsPath(rootDir);

  if (action === 'bash' || action.startsWith('bash:')) {
    // Detail format from the parent-owned bash registration is `<reason>: <command>`. The command
    // is the remainder after the first `": "` separator, remembered verbatim
    // so an exact-match allowlist cannot be widened by prefix tricks.
    const commandString = extractBashCommandFromDetail(detail);
    if (commandString) {
      await addBashAllowRule(projectsFile, projectPath, commandString);
    }
    return;
  }

  if (action === 'file-write' || action.startsWith('file-write:')) {
    // Detail is the resolved absolute path approved by the user.
    const trimmed = detail.trim();
    if (trimmed) {
      await addFileWriteAllowRule(projectsFile, projectPath, trimmed);
    }
    return;
  }

  if (action.startsWith('network:')) {
    if (action === 'network:web_search') {
      await allowNetworkWebSearch(projectsFile, projectPath);
      return;
    }
    if (action === 'network:web_fetch') {
      try {
        const hostname = new URL(detail).hostname;
        await allowNetworkFetchHost(projectsFile, projectPath, hostname);
      } catch {
        // ignore invalid url detail
      }
    }
  }
}
