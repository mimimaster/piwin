/**
 * Grok routing seams for HostRuntime (ADR 0082).
 *
 * Every function here is called from an existing Host command/lifecycle path
 * with an index record whose `backend.agentId === 'grok'`. Pi sessions never
 * reach this module. Grok handles plug into the same `sessions` map, run
 * registry, transcript recorder and permission map as Pi handles.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  HostResponse,
  SessionBackendBinding,
  SessionIndexRecord,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { formatError, isExternalBackendBinding } from '@piwin/contracts';
import { listProjects } from '@piwin/project';
import {
  deleteSessionRecord,
  getSessionRecord,
  renameSessionRecord,
  syncExternalSessionCatalog,
  upsertSessionRecord,
} from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { getPiwinProjectsPath, getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { createProductSessionId } from '../product-agent-host.js';
import { fail, ok } from '../response-helpers.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import { workingDirectoryFromIndexRecord } from '../session-scope.js';
import { GROK_AGENT_ID, createGrokSessionCapabilities, GROK_UNSUPPORTED_COMMANDS } from './grok-capabilities.js';
import type { GrokSessionHandle } from './grok-session-handle.js';

export function isGrokRecord(record: SessionIndexRecord | undefined): boolean {
  return record?.backend?.agentId === GROK_AGENT_ID;
}

export function isExternalRecord(record: SessionIndexRecord | undefined): boolean {
  return isExternalBackendBinding(record?.backend);
}

function indexPath(deps: HostRuntimeKernel): string {
  return getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot));
}

async function persistBinding(
  deps: HostRuntimeKernel,
  sessionId: string,
  patch: Partial<SessionBackendBinding>,
): Promise<SessionIndexRecord | undefined> {
  const record = await getSessionRecord(indexPath(deps), sessionId);
  if (record?.backend === undefined) {
    return undefined;
  }
  record.backend = { ...record.backend, ...patch };
  await upsertSessionRecord(indexPath(deps), record);
  return record;
}

/**
 * Cold activation of a Grok session inside `doActivateSessionRuntime`, after
 * residency admission reserved `runtimeGenerationId`. Opens the process,
 * binds the handle into the Host maps and, when the transcript projection is
 * missing or stale, rebuilds it from `session/load` replay. The caller owns
 * residency commit/abort.
 */
export async function activateGrokSession(
  deps: HostRuntimeKernel,
  record: SessionIndexRecord,
  runtimeGenerationId: string,
  runId: string | undefined,
  /** User row written for the prompt that triggered activation; kept last. */
  pendingUserMessageId?: string,
): Promise<GrokSessionHandle> {
  const binding = record.backend;
  if (binding === undefined) {
    throw new Error(`grok-binding-missing: ${record.id}`);
  }
  const service = deps.grokBackend;
  if (service === undefined) {
    throw new Error('grok-backend-unavailable: this Host has no Grok backend');
  }
  const cwd = workingDirectoryFromIndexRecord(record, deps.options.piwinRoot);
  // Replay when the projection has never been synced from Grok (a session
  // imported from the catalog, or a lost projection) or Grok changed it since
  // (e.g. the user continued in the TUI). Sessions created in piwin record
  // `syncedChangeUnixMs` on first bind, so they resume without replay.
  const catalogChange =
    binding.backendSessionId !== undefined
      ? (deps.grokCatalogChanges.get(binding.backendSessionId) ?? 0)
      : 0;
  const replay =
    binding.backendSessionId !== undefined &&
    (binding.syncedChangeUnixMs === undefined || binding.syncedChangeUnixMs < catalogChange);
  const opened = await service.openSession({ productSessionId: record.id, cwd, binding, replay });
  deps.runtimeController.attachGeneration(record.id, runtimeGenerationId, 'external-agent');
  if (runId !== undefined) {
    const attached = deps.runRegistry.attachRuntimeGeneration(runId, runtimeGenerationId);
    if (!attached.ok) {
      await opened.handle.release();
      deps.runtimeController.detachGeneration(record.id);
      throw new Error(`grok generation attach failed: ${attached.reason}`);
    }
  }
  const bindingPatch: Partial<SessionBackendBinding> = {
    backendSessionId: opened.backendSessionId,
    ...(opened.agentVersion !== undefined ? { agentVersion: opened.agentVersion } : {}),
  };
  if (binding.syncedChangeUnixMs === undefined && !replay) {
    // New piwin-created session: the projection is authoritative from here.
    bindingPatch.syncedChangeUnixMs = Date.now();
  }
  try {
    if (replay) {
      await rebuildTranscriptFromReplay(deps, record, opened.replayEvents, pendingUserMessageId);
      bindingPatch.syncedChangeUnixMs = Date.now();
    }
    await persistBinding(deps, record.id, bindingPatch);
    deps.host.registerExternalSession(record.id, opened.handle);
    await deps.bindSession(opened.handle, record.projectPath, record.name, undefined, runtimeGenerationId);
  } catch (error) {
    await deps.host.dropSession(record.id).catch(() => undefined);
    await opened.handle.release().catch(() => undefined);
    deps.runtimeController.detachGeneration(record.id);
    deps.sessions.delete(record.id);
    throw error;
  }
  return opened.handle;
}

/**
 * Replace the display projection with the Grok replay. Rows are rebuilt from
 * ordered replay events because Grok messages carry no ids.
 */
async function rebuildTranscriptFromReplay(
  deps: HostRuntimeKernel,
  record: SessionIndexRecord,
  events: readonly AgentEvent[],
  pendingUserMessageId: string | undefined,
): Promise<void> {
  const rows = replayEventsToRows(events);
  if (rows.length === 0) {
    return;
  }
  await deps.withTranscriptStore(
    record.id,
    async (store) => {
      const pending =
        pendingUserMessageId !== undefined ? await store.getMessage(pendingUserMessageId) : undefined;
      const existingIds: string[] = [];
      for await (const existing of store.iterateActivePath()) {
        existingIds.push(existing.id);
      }
      for (const id of existingIds) {
        await store.deleteMessage(id);
      }
      for (const row of rows) {
        await store.appendMessage({
          id: row.id,
          runtimeGenerationId: 'grok-replay',
          backendMessageId: row.id,
          role: row.role,
          text: row.text,
          status: 'done',
          createdAt: row.createdAt,
          ...(row.tools !== undefined ? { tools: row.tools } : {}),
        });
      }
      if (pending !== undefined) {
        // The prompt that triggered this activation stays after the history.
        await store.appendMessage({
          id: pending.id,
          runtimeGenerationId: 'grok-replay',
          backendMessageId: pending.id,
          role: pending.role,
          text: pending.text,
          status: pending.status,
          createdAt: new Date().toISOString(),
          ...(pending.contextRefs !== undefined ? { contextRefs: pending.contextRefs } : {}),
        });
      }
    },
    record.projectPath,
  );
}

type ReplayRow = {
  id: string;
  role: SessionTranscriptMessage['role'];
  text: string;
  createdAt: string;
  tools?: NonNullable<SessionTranscriptMessage['tools']>;
};

export function replayEventsToRows(events: readonly AgentEvent[]): ReplayRow[] {
  const rows: ReplayRow[] = [];
  const byId = new Map<string, ReplayRow>();
  const base = Date.now() - events.length;
  let ordinal = 0;
  let lastAssistant: ReplayRow | undefined;
  for (const event of events) {
    ordinal += 1;
    if (event.type === 'message/start') {
      const row: ReplayRow = {
        id: event.messageId,
        role: event.role,
        text: '',
        createdAt: new Date(base + ordinal).toISOString(),
      };
      rows.push(row);
      byId.set(event.messageId, row);
      if (event.role === 'assistant') lastAssistant = row;
      if (event.role === 'user') lastAssistant = undefined;
    } else if (event.type === 'message/text_delta') {
      const row = byId.get(event.messageId);
      if (row !== undefined) row.text += event.delta;
    } else if (event.type === 'tool/end') {
      let owner = event.responseMessageId !== undefined ? byId.get(event.responseMessageId) : lastAssistant;
      if (owner === undefined) {
        owner = { id: `grok-replay-${randomUUID()}`, role: 'assistant', text: '', createdAt: new Date(base + ordinal).toISOString() };
        rows.push(owner);
        byId.set(owner.id, owner);
        lastAssistant = owner;
      }
      owner.tools = [
        ...(owner.tools ?? []),
        {
          toolCallId: event.toolCallId,
          toolName: event.presentation?.title ?? 'tool',
          status: event.isError ? 'error' : 'done',
          output: event.presentation?.output?.text ?? '',
          ...(event.presentation !== undefined ? { presentation: event.presentation } : {}),
        },
      ];
    }
  }
  return rows.filter((row) => row.text !== '' || (row.tools?.length ?? 0) > 0);
}

/** Persist the backend binding on a freshly created product session. */
export async function bindNewGrokSession(
  deps: HostRuntimeKernel,
  sessionId: string,
  input: { modelId?: string; effortId?: string },
): Promise<SessionIndexRecord | undefined> {
  const service = deps.grokBackend;
  if (service === undefined) {
    throw new Error('grok-backend-unavailable: this Host has no Grok backend');
  }
  await service.requireReadyBinary();
  const record = await getSessionRecord(indexPath(deps), sessionId);
  if (record === undefined) {
    return undefined;
  }
  record.backend = {
    agentId: GROK_AGENT_ID,
    ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
    ...(input.effortId !== undefined ? { effortId: input.effortId } : {}),
  };
  await upsertSessionRecord(indexPath(deps), record);
  return record;
}

/** Refuse Pi-only commands for external sessions (ADR 0082 §3). */
export async function rejectUnsupportedExternalCommand(
  deps: HostRuntimeKernel,
  command: { type: string; sessionId?: unknown },
  requestId: string | undefined,
): Promise<HostResponse | null> {
  const operation = GROK_UNSUPPORTED_COMMANDS.get(command.type);
  if (operation === undefined || typeof command.sessionId !== 'string') {
    return null;
  }
  const record = await getSessionRecord(indexPath(deps), command.sessionId);
  if (!isGrokRecord(record)) {
    return null;
  }
  const support = createGrokSessionCapabilities().operations[operation];
  return fail(
    requestId,
    command.type,
    `backend-operation-unsupported: ${support.supported ? operation : support.reason}`,
    { code: 'backend-operation-unsupported' },
  );
}

/** `session/backend-get` / `session/backend-set`. */
export async function handleSessionBackendCommand(
  deps: HostRuntimeKernel,
  command:
    | { type: 'session/backend-get'; sessionId: string }
    | { type: 'session/backend-set'; sessionId: string; modelId?: string; effortId?: string; modeId?: string },
  requestId: string | undefined,
): Promise<HostResponse> {
  const record = await getSessionRecord(indexPath(deps), command.sessionId);
  if (record === undefined) {
    return fail(requestId, command.type, `Unknown session: ${command.sessionId}`);
  }
  if (!isGrokRecord(record)) {
    return ok(requestId, command.type, { agentId: 'pi' });
  }
  const service = deps.grokBackend;
  if (command.type === 'session/backend-get') {
    return ok(requestId, command.type, {
      agentId: GROK_AGENT_ID,
      capabilities: createGrokSessionCapabilities(),
      ...(service?.getSessionOptions(record.id) !== undefined
        ? { options: service.getSessionOptions(record.id) }
        : {}),
    });
  }
  const fields = [command.modelId, command.effortId, command.modeId].filter((value) => value !== undefined);
  if (fields.length !== 1) {
    return fail(requestId, command.type, 'backend-set requires exactly one of modelId, effortId, modeId');
  }
  const live = deps.sessions.get(record.id) as GrokSessionHandle | undefined;
  try {
    if (live !== undefined && live.backendAgentId === GROK_AGENT_ID) {
      if (command.modelId !== undefined) await live.setModel(command.modelId);
      if (command.effortId !== undefined) await live.setEffort(command.effortId);
      if (command.modeId !== undefined) await live.setMode(command.modeId);
    }
    // Persist so the next resume re-applies the choice.
    await persistBinding(deps, record.id, {
      ...(command.modelId !== undefined ? { modelId: command.modelId } : {}),
      ...(command.effortId !== undefined ? { effortId: command.effortId } : {}),
      ...(command.modeId !== undefined ? { modeId: command.modeId } : {}),
    });
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
  return ok(requestId, command.type, {
    agentId: GROK_AGENT_ID,
    ...(live !== undefined ? { options: live.getBackendOptions() } : {}),
  });
}

/** Rename writes through to Grok first so both sides agree. */
export async function renameGrokSession(
  deps: HostRuntimeKernel,
  record: SessionIndexRecord,
  name: string,
): Promise<void> {
  const backendSessionId = record.backend?.backendSessionId;
  if (backendSessionId !== undefined) {
    await deps.grokBackend?.renameCatalogSession(backendSessionId, name);
  }
  await renameSessionRecord(indexPath(deps), record.id, name);
}

/** Permanent delete: Grok session first, then the product record + projection. */
export async function deleteGrokSessionEverywhere(
  deps: HostRuntimeKernel,
  record: SessionIndexRecord,
): Promise<void> {
  const backendSessionId = record.backend?.backendSessionId;
  if (backendSessionId !== undefined) {
    await deps.grokBackend?.deleteCatalogSession(backendSessionId);
  }
  deps.grokBackend?.forgetSession(record.id);
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
