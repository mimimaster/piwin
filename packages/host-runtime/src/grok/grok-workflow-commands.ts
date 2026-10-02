/**
 * Workflow reads for external agent sessions (ADR 0082).
 *
 * The adapter owns its workflow files, so the Host asks the session bridge
 * instead of parsing vendor state on disk. A session that is not resident is
 * activated the same way a prompt would activate it. A handle that is absent or
 * cannot list workflows degrades to "no workflows" rather than inventing data
 * or surfacing a raw TypeError in the chat.
 */

import { formatError } from '@piwin/contracts';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { getSessionRecord } from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import type { AgentPluginSession } from '../agent-plugin-session.js';

export async function handleExternalWorkflowCommand(
  deps: HostRuntimeKernel,
  command: Extract<HostCommand, { type: 'agents/workflows' | 'agents/workflow-report' }>,
  requestId: string | undefined,
): Promise<HostResponse> {
  try {
    const record = await getSessionRecord(
      getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot)),
      command.sessionId,
    );
    if (!record) return fail(requestId, command.type, 'unknown-session');
    if (record.backend === undefined) {
      return command.type === 'agents/workflows'
        ? ok(requestId, command.type, { sessionId: command.sessionId, workflows: [] })
        : fail(requestId, command.type, 'workflow-not-found');
    }
    const session = await residentExternalSession(deps, record.id);
    if (session === undefined) {
      return command.type === 'agents/workflows'
        ? ok(requestId, command.type, { sessionId: record.id, workflows: [] })
        : fail(requestId, command.type, 'workflow-not-found');
    }
    if (command.type === 'agents/workflow-report') {
      if (!/^wf_[a-zA-Z0-9_-]+$/.test(command.workflowId)) {
        return fail(requestId, command.type, 'invalid-workflow-id');
      }
      const text = await session.readWorkflowReport(command.workflowId);
      return text === undefined
        ? fail(requestId, command.type, 'workflow-report-not-found')
        : ok(requestId, command.type, { sessionId: record.id, workflowId: command.workflowId, text });
    }
    return ok(requestId, command.type, { sessionId: record.id, workflows: await session.listWorkflows() });
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}

function workflowSession(session: unknown): AgentPluginSession | undefined {
  if (typeof session !== 'object' || session === null) return undefined;
  const candidate = session as { listWorkflows?: unknown; readWorkflowReport?: unknown };
  return typeof candidate.listWorkflows === 'function' && typeof candidate.readWorkflowReport === 'function'
    ? session as AgentPluginSession
    : undefined;
}

async function residentExternalSession(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<AgentPluginSession | undefined> {
  const existing = workflowSession(deps.sessions.get(sessionId));
  if (existing !== undefined) return existing;
  try {
    await deps.ensureLiveSession(sessionId);
  } catch {
    return undefined;
  }
  // ensureLiveSession returns whatever is already resident. A Pi handle, or any
  // other object without these methods, must not be called.
  return workflowSession(deps.sessions.get(sessionId));
}
