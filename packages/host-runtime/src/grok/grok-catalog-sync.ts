/**
 * External agent session catalog sync and title adoption (ADR 0082). The
 * adapter catalog is authoritative for which agent sessions exist and what
 * they are called.
 */

import type { AgentPluginNativeObservation, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { listProjects } from '@piwin/project';
import {
  deleteSessionRecord,
  getSessionRecord,
  syncExternalSessionCatalog,
  updateSessionRecord,
  isPlaceholderSessionName,
} from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import {
  getPiwinProjectsPath,
  getPiwinRoot,
  getPiwinSessionIndexPath,
} from '../paths.js';
import { createProductSessionId } from '../product-agent-host.js';
import { fail, ok } from '../response-helpers.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { indexRecordToSummary } from '../session-summary-map.js';

/** Map an adapter cwd onto a product project, or `''` for Conversations. */
export function resolveExternalCatalogProjectPath(
  cwd: string | undefined,
  projectRoots: readonly string[],
): string {
  if (cwd === undefined) {
    return '';
  }
  const matched = [...projectRoots]
    .sort((left, right) => right.length - left.length)
    .find((root) => cwd === root || cwd.startsWith(`${root}/`));
  return matched ?? '';
}

function indexPath(deps: HostRuntimeKernel): string {
  return getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot));
}

/** Merge one adapter's catalog into the index and push list changes. */
export async function syncExternalAgentCatalog(
  deps: HostRuntimeKernel,
  agentId: string,
  requestId: string | undefined,
): Promise<HostResponse> {
  const service = deps.externalAgents;
  if (service === undefined) {
    return fail(requestId, 'agents/sessions-sync', 'external-agent-backend-unavailable');
  }
  try {
    const catalog = await service.listCatalog(agentId);
    for (const entry of catalog) {
      if (entry.lastChangeUnixMs !== undefined) {
        deps.externalCatalogChanges.set(entry.backendSessionId, entry.lastChangeUnixMs);
      }
    }
    const rootDir = getPiwinRoot(deps.options.piwinRoot);
    const projects = await listProjects(getPiwinProjectsPath(rootDir));
    const roots = projects.map((project) => project.path);
    // Subagent / internal sessions belong to the agent; only user sessions map.
    const visible = catalog.filter((entry) => entry.originKind !== 'subagent');
    const result = await syncExternalSessionCatalog({
      indexPath: indexPath(deps),
      agentId,
      entries: visible.map((entry) => ({
        backendSessionId: entry.backendSessionId,
        ...(entry.title !== undefined ? { title: entry.title } : {}),
        ...(entry.cwd !== undefined ? { cwd: entry.cwd } : {}),
        ...(entry.lastChangeUnixMs !== undefined ? { lastChangeUnixMs: entry.lastChangeUnixMs } : {}),
      })),
      createProductSessionId,
      preserveMissingSession: (record) => deps.agentCliOwnership?.isDesktopWriterBlocked(record.id) === true ||
        deps.runRegistry.getForegroundRun(record.id) !== undefined,
      resolveProjectPath: (cwd) => resolveExternalCatalogProjectPath(cwd, roots),
    });
    for (const record of result.created) {
      deps.push(sessionIndexUpdatedPush({ op: 'created', sessionId: record.id, session: indexRecordToSummary(record) }));
    }
    for (const record of result.updated) {
      deps.push(sessionIndexUpdatedPush({ op: 'updated', sessionId: record.id, session: indexRecordToSummary(record) }));
    }
    for (const record of result.removed) {
      if (deps.sessions.has(record.id)) {
        await deps.disposeLiveSession(record.id, 'manual');
      }
      await deleteSessionRecord(indexPath(deps), record.id);
      deps.push(sessionIndexUpdatedPush({ op: 'deleted', sessionId: record.id }));
    }
    return ok(requestId, 'agents/sessions-sync', {
      agentId,
      created: result.created.length,
      updated: result.updated.length,
      removed: result.removed.length,
    });
  } catch (error) {
    return fail(requestId, 'agents/sessions-sync', formatError(error));
  }
}

/**
 * Apply an observed title under the index lock; a user rename stays
 * authoritative. The agent's `lastChangeUnixMs` is deliberately not adopted as
 * `updatedAt`: resuming or idling a native session moves it too, so trusting it
 * reorders the list whenever a session is merely opened.
 */
export async function applyExternalAgentMetadata(
  deps: HostRuntimeKernel,
  sessionId: string,
  patch: Partial<Pick<AgentPluginNativeObservation, 'title' | 'backendSessionId'>>,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const title = patch.title;
  if (title === undefined || isPlaceholderSessionName(title)) return;
  const needsChange = (record: Awaited<ReturnType<typeof getSessionRecord>>): boolean => record !== undefined &&
    isCurrent() && (patch.backendSessionId === undefined || record.backend?.backendSessionId === patch.backendSessionId) &&
    record.nameSource !== 'user' && record.name !== title;
  if (!needsChange(await getSessionRecord(indexPath(deps), sessionId))) return;
  let changed = false;
  const updated = await updateSessionRecord(indexPath(deps), sessionId, (record) => {
    if (!needsChange(record)) return;
    record.name = title;
    record.nameSource = 'llm';
    changed = true;
  });
  if (updated === undefined || !changed || !isCurrent()) return;
  deps.push(sessionIndexUpdatedPush({ op: 'updated', sessionId, session: indexRecordToSummary(updated) }));
  deps.push({ type: 'session/name-updated', sessionId, name: title, nameSource: 'llm' });
}

/**
 * The conversation itself changed outside a Host turn (native CLI input, or a
 * replay that imported new rows): move the session's activity time forward.
 */
export async function markExternalConversationActivity(
  deps: HostRuntimeKernel,
  sessionId: string,
  changedAtUnixMs: number,
): Promise<void> {
  const updatedAt = new Date(changedAtUnixMs).toISOString();
  let changed = false;
  const updated = await updateSessionRecord(indexPath(deps), sessionId, (record) => {
    if (updatedAt <= record.updatedAt) return;
    record.updatedAt = updatedAt;
    changed = true;
  });
  if (updated === undefined || !changed) return;
  deps.push(sessionIndexUpdatedPush({ op: 'updated', sessionId, session: indexRecordToSummary(updated) }));
}

/** The adapter reported a title: adopt it unless the user renamed the session. */
export async function applyExternalAgentTitle(deps: HostRuntimeKernel, sessionId: string, title: string): Promise<void> {
  await applyExternalAgentMetadata(deps, sessionId, { title });
}
