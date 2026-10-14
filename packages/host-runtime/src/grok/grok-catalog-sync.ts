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
  getPiwinGeneralWorkspacePath,
  getPiwinProjectsPath,
  getPiwinRoot,
  getPiwinSessionIndexPath,
} from '../paths.js';
import { createProductSessionId } from '../product-agent-host.js';
import { fail, ok } from '../response-helpers.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { indexRecordToSummary } from '../session-summary-map.js';

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
    const roots = projects.map((project) => project.path).sort((left, right) => right.length - left.length);
    const generalWorkspace = getPiwinGeneralWorkspacePath(rootDir);
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
      resolveProjectPath: (cwd) => {
        if (cwd !== undefined) {
          const matched = roots.find((root) => cwd === root || cwd.startsWith(`${root}/`));
          if (matched !== undefined) return matched;
        }
        // Unmatched Grok sessions are agent chats under No Repo, never Chat.
        return generalWorkspace;
      },
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

/** Apply observed metadata under the index lock; local user fields remain authoritative. */
export async function applyExternalAgentMetadata(
  deps: HostRuntimeKernel,
  sessionId: string,
  patch: Partial<Pick<AgentPluginNativeObservation, 'title' | 'lastChangeUnixMs' | 'backendSessionId'>>,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const needsChange = (record: Awaited<ReturnType<typeof getSessionRecord>>): boolean => record !== undefined &&
    isCurrent() && (patch.backendSessionId === undefined || record.backend?.backendSessionId === patch.backendSessionId) &&
    ((patch.title !== undefined && !isPlaceholderSessionName(patch.title) && record.nameSource !== 'user' && record.name !== patch.title) ||
      (patch.lastChangeUnixMs !== undefined && patch.lastChangeUnixMs > Date.parse(record.updatedAt)));
  if (!needsChange(await getSessionRecord(indexPath(deps), sessionId))) return;
  let changed = false;
  let titleChanged = false;
  const updated = await updateSessionRecord(indexPath(deps), sessionId, (record) => {
    if (!needsChange(record)) return;
    if (patch.title !== undefined && !isPlaceholderSessionName(patch.title) && record.nameSource !== 'user' && record.name !== patch.title) {
      record.name = patch.title;
      record.nameSource = 'llm';
      titleChanged = true;
    }
    if (patch.lastChangeUnixMs !== undefined && patch.lastChangeUnixMs > Date.parse(record.updatedAt)) {
      record.updatedAt = new Date(patch.lastChangeUnixMs).toISOString();
    }
    changed = true;
  });
  if (updated === undefined || !changed || !isCurrent()) return;
  deps.push(sessionIndexUpdatedPush({ op: 'updated', sessionId, session: indexRecordToSummary(updated) }));
  if (titleChanged && updated.name !== undefined) {
    deps.push({ type: 'session/name-updated', sessionId, name: updated.name, nameSource: 'llm' });
  }
}

/** The adapter reported a title: adopt it unless the user renamed the session. */
export async function applyExternalAgentTitle(deps: HostRuntimeKernel, sessionId: string, title: string): Promise<void> {
  await applyExternalAgentMetadata(deps, sessionId, { title });
}
