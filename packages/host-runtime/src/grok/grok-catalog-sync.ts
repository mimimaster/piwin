/**
 * Grok session catalog sync and title adoption (ADR 0082). The Grok catalog
 * is authoritative for which Grok sessions exist and what they are called.
 */

import type { HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { listProjects } from '@piwin/project';
import {
  deleteSessionRecord,
  getSessionRecord,
  syncExternalSessionCatalog,
  upsertSessionRecord,
} from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { getPiwinProjectsPath, getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { createProductSessionId } from '../product-agent-host.js';
import { fail, ok } from '../response-helpers.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import { GROK_AGENT_ID } from './grok-capabilities.js';

function indexPath(deps: HostRuntimeKernel): string {
  return getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot));
}

/** Merge the Grok catalog into the index and push list changes. */
export async function syncGrokCatalog(
  deps: HostRuntimeKernel,
  requestId: string | undefined,
): Promise<HostResponse> {
  const service = deps.grokBackend;
  if (service === undefined) {
    return fail(requestId, 'agents/sessions-sync', 'grok-backend-unavailable');
  }
  try {
    const catalog = await service.listCatalog();
    for (const entry of catalog) {
      if (entry.lastChangeUnixMs !== undefined) {
        deps.grokCatalogChanges.set(entry.backendSessionId, entry.lastChangeUnixMs);
      }
    }
    const projects = await listProjects(getPiwinProjectsPath(getPiwinRoot(deps.options.piwinRoot)));
    const roots = projects.map((project) => project.path).sort((left, right) => right.length - left.length);
    // Subagent / internal sessions are Grok-internal; only user sessions map.
    const visible = catalog.filter((entry) => entry.originKind !== 'subagent');
    const result = await syncExternalSessionCatalog({
      indexPath: indexPath(deps),
      agentId: GROK_AGENT_ID,
      entries: visible.map((entry) => ({
        backendSessionId: entry.backendSessionId,
        ...(entry.title !== undefined ? { title: entry.title } : {}),
        ...(entry.cwd !== undefined ? { cwd: entry.cwd } : {}),
        ...(entry.lastChangeUnixMs !== undefined ? { lastChangeUnixMs: entry.lastChangeUnixMs } : {}),
      })),
      createProductSessionId,
      resolveProjectPath: (cwd) =>
        cwd === undefined
          ? ''
          : (roots.find((root) => cwd === root || cwd.startsWith(`${root}/`)) ?? ''),
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
      agentId: GROK_AGENT_ID,
      created: result.created.length,
      updated: result.updated.length,
      removed: result.removed.length,
    });
  } catch (error) {
    return fail(requestId, 'agents/sessions-sync', formatError(error));
  }
}

/** Grok reported a title: adopt it unless the user renamed the session. */
export async function applyGrokTitle(
  deps: HostRuntimeKernel,
  sessionId: string,
  title: string,
): Promise<void> {
  const record = await getSessionRecord(indexPath(deps), sessionId);
  if (record === undefined || record.nameSource === 'user' || record.name === title) {
    return;
  }
  record.name = title;
  record.nameSource = 'llm';
  await upsertSessionRecord(indexPath(deps), record);
  deps.push({ type: 'session/name-updated', sessionId, name: title, nameSource: 'llm' });
}
