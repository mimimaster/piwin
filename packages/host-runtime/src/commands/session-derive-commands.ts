/**
 * Session derivation commands: `session/duplicate` makes an independent full
 * copy, `session/fork` a linked transcript prefix. Both build a new session
 * from a source one, so the transcript, media and model-context copy helpers
 * live here rather than in the index command dispatcher.
 */
import { rm } from 'node:fs/promises';
import { formatCompactionBoundary, formatError } from '@piwin/contracts';
import { rejectUnavailableSessionBody } from '../session-body-guard.js';
import type {
  CreateSessionInput,
  HostCommand,
  HostResponse,
  ProductSessionOrigin,
  SessionTranscriptMessage,
  SessionCompactionRecord,
} from '@piwin/contracts';
import {
  deleteSessionRecord,
  buildDuplicateSessionName,
  buildForkSessionName,
  cloneTranscriptMessage,
  createSessionRecord,
  getSessionRecord,
  upsertSessionRecord,
  type SessionTranscriptStore,
  copyModelContextLedger,
  seedDerivedSessionContextState,
  type TranscriptStoreMessageInput,
} from '@piwin/session';
import { getSessionLineage } from '@piwin/session';
import { cloneSessionMedia, cleanupFailedMediaClone } from '@piwin/media';
import { listProjects } from '@piwin/project';
import { fail, ok } from '../response-helpers.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import { hasDisplayableAssistantResponse } from '../derived-session-context-evidence.js';
import {
  getPiwinMediaDir,
  getPiwinSessionModelContextDatabasePath,
  getPiwinProjectsPath,
  getPiwinSessionDir,
} from '../paths.js';
import { createSessionMessageResponse } from '../session-message-response.js';
import { logRollbackFailure } from '../rollback-cleanup.js';
import type { SessionProductCommandContext } from './session-product-command-context.js';

type SessionDuplicateCommand = Extract<HostCommand, { type: 'session/duplicate' }>;
type SessionForkCommand = Extract<HostCommand, { type: 'session/fork' }>;

/** What a derivation needs from the command dispatcher. */
export type SessionDeriveDeps = {
  context: SessionProductCommandContext;
  rootDir: string;
  indexPath: string;
};

export async function handleSessionDuplicate(
  command: SessionDuplicateCommand,
  requestId: string | undefined,
  deps: SessionDeriveDeps,
): Promise<HostResponse> {
  const { context, rootDir, indexPath } = deps;
  const source = await getSessionRecord(indexPath, command.sessionId);
  if (!source) {
    return fail(requestId, 'session/duplicate', `Unknown session: ${command.sessionId}`);
  }
  const rejectedDuplicate = rejectUnavailableSessionBody(
    requestId,
    'session/duplicate',
    source,
    'duplicate',
  );
  if (rejectedDuplicate) {
    return rejectedDuplicate;
  }
  const targetScope =
    command.targetScope ??
    source.scope ??
    (source.projectPath
      ? ({ kind: 'project', projectPath: source.projectPath } as const)
      : ({ kind: 'general' } as const));
  const targetProjectPath = targetScope.kind === 'project' ? targetScope.projectPath.trim() : '';
  if (targetScope.kind === 'project' && !targetProjectPath) {
    return fail(
      requestId,
      'session/duplicate',
      'target project scope requires a non-empty projectPath',
    );
  }
  if (command.targetScope?.kind === 'project') {
    const project = (await listProjects(getPiwinProjectsPath(rootDir))).find(
      (candidate) => candidate.path === targetProjectPath,
    );
    if (!project || project.trust !== 'trusted') {
      return fail(
        requestId,
        'session/duplicate',
        'target project must be opened and trusted before continuing the session',
      );
    }
  }
  const createInput: CreateSessionInput = {
    projectPath: targetProjectPath,
    scope:
      targetScope.kind === 'project'
        ? { kind: 'project', projectPath: targetProjectPath }
        : { kind: 'general' },
  };
  if (typeof command.name === 'string' && command.name.trim().length > 0) {
    createInput.sessionName = command.name.trim();
  }
  const created = await context.createSession(createInput);
  try {
    const sourceStore = await context.getTranscriptStore(command.sessionId);
    const targetStore = await context.getTranscriptStore(created.id, targetProjectPath);
    const latestCompaction = await sourceStore.readLatestCompaction();
    let messageCount = 0;
    let lastMessage: SessionTranscriptMessage | undefined;
    let historyHasDisplayableResponse = false;
    const messageIdMap = new Map<string, string>();
    for await (const message of sourceStore.iterateActivePath(100)) {
      const cloned = cloneTranscriptMessage(message);
      messageIdMap.set(message.id, cloned.id);
      await appendDerivedMessage(targetStore, cloned);
      await copyNativeEntries(sourceStore, targetStore, message.id, cloned.id);
      messageCount += 1;
      lastMessage = cloned;
      historyHasDisplayableResponse ||= hasDisplayableAssistantResponse(message);
    }
    const copiedCompaction = await copyDerivedCompaction({
      source: latestCompaction,
      target: targetStore,
      targetSessionId: created.id,
      messageIdMap,
    });
    await copyModelContextLedger({
      sourceDbPath: getPiwinSessionModelContextDatabasePath(rootDir, command.sessionId),
      sourceSessionId: command.sessionId,
      targetDbPath: getPiwinSessionModelContextDatabasePath(rootDir, created.id),
      targetSessionId: created.id,
      messageIdMap,
    });
    await seedDerivedSessionContextState({
      source: sourceStore,
      target: targetStore,
      targetSessionId: created.id,
      updatedAt: new Date().toISOString(),
      historyHasDisplayableResponse,
      ...(copiedCompaction !== undefined
        ? { compactionBoundary: formatCompactionBoundary(copiedCompaction) }
        : {}),
    });
    const displayName =
      typeof command.name === 'string' && command.name.trim().length > 0
        ? command.name.trim()
        : command.targetScope
          ? (source.name ?? `session-${source.id.slice(0, 8)}`)
          : buildDuplicateSessionName(source.name, source.id);
    await context.bindSession(created, targetProjectPath, displayName, {
      kind: 'main',
      depth: 0,
    });
    const record =
      (await getSessionRecord(indexPath, created.id)) ??
      createSessionRecord({
        id: created.id,
        projectPath: targetProjectPath,
        scope:
          targetScope.kind === 'project'
            ? { kind: 'project', projectPath: targetProjectPath }
            : { kind: 'general' },
        ...(targetScope.kind === 'project' ? { workingDirectory: targetProjectPath } : {}),
        name: displayName,
        kind: 'main',
        depth: 0,
      });
    record.messageCount = messageCount;
    if (lastMessage?.text) record.lastPreview = lastMessage.text.slice(0, 160);
    record.origin = {
      kind: 'duplicate',
      sourceSessionId: command.sessionId,
      ...(source.name ? { sourceSessionNameSnapshot: source.name } : {}),
      createdAt: new Date().toISOString(),
    };
    record.isPinned = false;
    record.isArchived = false;
    if (source.model) record.model = source.model;
    if (source.thinkingLevel) record.thinkingLevel = source.thinkingLevel;
    await upsertSessionRecord(indexPath, record);
    const messages = await targetStore.listTail(50);
    await releaseEmptyDerivedRuntime(context, created.id);
    context.pushStatus();
    const duplicated = indexRecordToSummary(record);
    context.push?.(
      sessionIndexUpdatedPush({
        op: 'created',
        sessionId: created.id,
        session: duplicated,
      }),
    );
    return ok(requestId, 'session/duplicate', {
      sessionId: created.id,
      sourceSessionId: command.sessionId,
      session: duplicated,
      ...createSessionMessageResponse(created.id, messages, command.messageProjection),
    });
  } catch (error) {
    await context
      .disposeLiveSession(created.id)
      .catch(logRollbackFailure('dispose-live-session', created.id));
    await deleteSessionRecord(indexPath, created.id).catch(
      logRollbackFailure('delete-session-record', created.id),
    );
    await rm(getPiwinSessionDir(rootDir, created.id), { recursive: true, force: true });
    return fail(requestId, 'session/duplicate', `Duplicate failed: ${formatError(error)}`);
  }
}

export async function handleSessionFork(
  command: SessionForkCommand,
  requestId: string | undefined,
  deps: SessionDeriveDeps,
): Promise<HostResponse> {
  const { context, rootDir, indexPath } = deps;
  const source = await getSessionRecord(indexPath, command.sessionId);
  if (!source) {
    return fail(requestId, 'session/fork', `Unknown session: ${command.sessionId}`);
  }
  const rejectedFork = rejectUnavailableSessionBody(requestId, 'session/fork', source, 'fork');
  if (rejectedFork) {
    return rejectedFork;
  }
  if (source.isArchived === true) {
    return fail(requestId, 'session/fork', 'Source session is archived');
  }
  const sourceStore = await context.getTranscriptStore(command.sessionId);
  const selected = await resolveForkAssistantMessage(sourceStore, command.messageId);
  if (selected === undefined || selected.role !== 'assistant') {
    return fail(requestId, 'session/fork', 'Selected assistant response was not found');
  }
  if (selected.status !== 'done') {
    return fail(
      requestId,
      'session/fork',
      `Selected response is not complete (status: ${selected.status})`,
    );
  }
  const createInput: CreateSessionInput = {
    projectPath: source.projectPath,
  };
  if (source.scope) {
    createInput.scope = source.scope;
  }
  const created = await context.createSession(createInput);
  const mediaRoot = getPiwinMediaDir(rootDir);
  const lineage = await getSessionLineage({ indexPath }, command.sessionId);
  const existingForkNames = lineage.nodes
    .map((node) => node.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);

  try {
    const targetStore = await context.getTranscriptStore(created.id, source.projectPath);
    const latestCompaction = await sourceStore.readLatestCompaction();
    let messageCount = 0;
    let lastMessage: SessionTranscriptMessage | undefined;
    let historyHasDisplayableResponse = false;
    let reachedSelection = false;
    const messageIdMap = new Map<string, string>();
    const retainedRunIds = new Set<string>();
    let lastSourceUserMessageId: string | undefined;
    for await (const message of sourceStore.iterateActivePath(100)) {
      const cloned = cloneTranscriptMessage(message);
      messageIdMap.set(message.id, cloned.id);
      if (message.role === 'user') lastSourceUserMessageId = message.id;
      if (message.runId) retainedRunIds.add(message.runId);
      if (cloned.runId) retainedRunIds.add(cloned.runId);
      if (cloned.attachments !== undefined) {
        const singleMessageDocument = {
          version: 1 as const,
          sessionId: created.id,
          projectPath: source.projectPath,
          messages: [cloned],
          updatedAt: new Date().toISOString(),
        };
        await cloneSessionMedia(singleMessageDocument, {
          mediaRoot,
          targetSessionId: created.id,
        });
      }
      await appendDerivedMessage(targetStore, cloned);
      await copyNativeEntries(sourceStore, targetStore, message.id, cloned.id);
      messageCount += 1;
      lastMessage = cloned;
      historyHasDisplayableResponse ||= hasDisplayableAssistantResponse(message);
      if (message.id === selected.id) {
        reachedSelection = true;
        break;
      }
    }
    const copiedCompaction = await copyDerivedCompaction({
      source: latestCompaction,
      target: targetStore,
      targetSessionId: created.id,
      messageIdMap,
    });
    await copyModelContextLedger({
      sourceDbPath: getPiwinSessionModelContextDatabasePath(rootDir, command.sessionId),
      sourceSessionId: command.sessionId,
      targetDbPath: getPiwinSessionModelContextDatabasePath(rootDir, created.id),
      targetSessionId: created.id,
      messageIdMap,
      retain: {
        sourceMessageIds: new Set(messageIdMap.keys()),
        runIds: retainedRunIds,
      },
      ...(lastSourceUserMessageId === undefined
        ? {}
        : { boundarySourceMessageId: lastSourceUserMessageId }),
      boundaryCreatedAt: selected.createdAt,
    });
    await seedDerivedSessionContextState({
      source: sourceStore,
      target: targetStore,
      targetSessionId: created.id,
      updatedAt: new Date().toISOString(),
      historyHasDisplayableResponse,
      ...(copiedCompaction !== undefined
        ? { compactionBoundary: formatCompactionBoundary(copiedCompaction) }
        : {}),
    });
    if (!reachedSelection) {
      throw new Error(`Message not found while streaming source transcript: ${selected.id}`);
    }
    const displayName =
      typeof command.name === 'string' && command.name.trim().length > 0
        ? command.name.trim()
        : buildForkSessionName(source.name, source.id, existingForkNames);
    await context.bindSession(created, source.projectPath, displayName, {
      kind: 'main',
      depth: 0,
    });
    const record =
      (await getSessionRecord(indexPath, created.id)) ??
      createSessionRecord({
        id: created.id,
        projectPath: source.projectPath,
        ...(source.scope ? { scope: source.scope } : {}),
        ...(source.workingDirectory ? { workingDirectory: source.workingDirectory } : {}),
        name: displayName,
        nameSource: 'text',
        kind: 'main',
        depth: 0,
      });
    const origin: ProductSessionOrigin = {
      kind: 'fork',
      rootSessionId: source.origin?.kind === 'fork' ? source.origin.rootSessionId : source.id,
      sourceSessionId: command.sessionId,
      ...(source.name ? { sourceSessionNameSnapshot: source.name } : {}),
      sourceMessageId: selected.id,
      sourceMessageRole: 'assistant',
      sourceMessagePreview: selected.text.slice(0, 200),
      sourceMessageCreatedAt: selected.createdAt,
      workspaceStrategy: command.workspaceStrategy,
      createdAt: new Date().toISOString(),
    };
    record.messageCount = messageCount;
    if (lastMessage?.text) record.lastPreview = lastMessage.text.slice(0, 160);
    record.origin = origin;
    if (source.model) record.model = source.model;
    if (source.thinkingLevel) record.thinkingLevel = source.thinkingLevel;
    await upsertSessionRecord(indexPath, record);
    const messages = await targetStore.listTail(50);
    await releaseEmptyDerivedRuntime(context, created.id);
    context.pushStatus();
    const forked = indexRecordToSummary(record);
    context.push?.(
      sessionIndexUpdatedPush({
        op: 'created',
        sessionId: created.id,
        session: forked,
      }),
    );
    return ok(requestId, 'session/fork', {
      sessionId: created.id,
      sourceSessionId: command.sessionId,
      session: forked,
      ...createSessionMessageResponse(created.id, messages, command.messageProjection),
      origin,
    });
  } catch (error) {
    await cleanupFailedMediaClone(mediaRoot, created.id);
    await context
      .disposeLiveSession(created.id)
      .catch(logRollbackFailure('dispose-live-session', created.id));
    await deleteSessionRecord(indexPath, created.id).catch(
      logRollbackFailure('delete-session-record', created.id),
    );
    await rm(getPiwinSessionDir(rootDir, created.id), { recursive: true, force: true });
    return fail(requestId, 'session/fork', `Fork failed: ${formatError(error)}`);
  }
}

async function appendDerivedMessage(
  store: SessionTranscriptStore,
  message: SessionTranscriptMessage,
): Promise<void> {
  const metadata: NonNullable<TranscriptStoreMessageInput['metadata']> = {
    ...(message.phaseHistory !== undefined ? { phaseHistory: message.phaseHistory } : {}),
    ...(message.startedAt !== undefined ? { startedAt: message.startedAt } : {}),
    ...(message.endedAt !== undefined ? { endedAt: message.endedAt } : {}),
    ...(message.thinkingStartedAt !== undefined
      ? { thinkingStartedAt: message.thinkingStartedAt }
      : {}),
    ...(message.thinkingEndedAt !== undefined ? { thinkingEndedAt: message.thinkingEndedAt } : {}),
    ...(message.outcome !== undefined ? { outcome: message.outcome } : {}),
    ...(message.terminalMessage !== undefined ? { terminalMessage: message.terminalMessage } : {}),
    ...(message.failure !== undefined ? { failure: message.failure } : {}),
    ...(message.agentStopReason !== undefined ? { agentStopReason: message.agentStopReason } : {}),
    ...(message.subagentActivity !== undefined
      ? { subagentActivity: message.subagentActivity }
      : {}),
    ...(message.searchEvidence !== undefined ? { searchEvidence: message.searchEvidence } : {}),
    ...(message.instructionDelivery !== undefined
      ? { instructionDelivery: message.instructionDelivery }
      : {}),
    ...(message.docCardSequence !== undefined ? { docCardSequence: message.docCardSequence } : {}),
    ...(message.replyWriter !== undefined ? { replyWriter: message.replyWriter } : {}),
    ...(message.workspaceWrites !== undefined ? { workspaceWrites: message.workspaceWrites } : {}),
    ...(message.discardedAttemptWrites !== undefined
      ? { discardedAttemptWrites: message.discardedAttemptWrites }
      : {}),
    ...(message.source !== undefined ? { promptSource: message.source } : {}),
    ...(message.voiceCallId !== undefined ? { voiceCallId: message.voiceCallId } : {}),
    ...(message.skillId !== undefined ? { skillId: message.skillId } : {}),
  };
  const result = await store.appendMessage({
    id: message.id,
    runtimeGenerationId: 'derived-copy-v1',
    backendMessageId: message.id,
    role: message.role,
    text: message.text,
    status: message.status,
    createdAt: message.createdAt,
    ...(message.thinking !== undefined ? { thinking: message.thinking } : {}),
    ...(message.runId !== undefined ? { runId: message.runId } : {}),
    ...(message.model !== undefined ? { model: message.model } : {}),
    ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
    ...(message.contextRefs !== undefined ? { contextRefs: message.contextRefs } : {}),
    ...(message.tools !== undefined ? { tools: message.tools } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  });
  if (!result.ok) {
    throw new Error(`Derived transcript identity collision: ${message.id}`);
  }
}

const FORK_DEFAULT_SOURCE_TAIL_ROWS = 100;

async function resolveForkAssistantMessage(
  store: SessionTranscriptStore,
  messageId: string | undefined,
): Promise<SessionTranscriptMessage | undefined> {
  if (messageId !== undefined) {
    return store.getMessage(messageId);
  }
  // The store serves at most this many tail rows; asking for more is refused outright.
  const tail = await store.listTail(FORK_DEFAULT_SOURCE_TAIL_ROWS);
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const message = tail[index];
    if (message?.role === 'assistant' && message.status === 'done') {
      return message;
    }
  }
  return undefined;
}

/**
 * Carry native context copies (spec: session-conversation-tree §4.2) onto the
 * derived row so fork/duplicate targets can cold-activate with full-fidelity
 * replay instead of text-only seeds.
 */
/**
 * `createSession` activates a warm backend before the history is copied, so
 * that runtime's model context is empty. Drop it once the durable copy is
 * complete; the next turn then cold-activates and replays the copied
 * transcript (cold-activation-seed) instead of starting from a blank context.
 */
async function releaseEmptyDerivedRuntime(
  context: Pick<SessionProductCommandContext, 'disposeLiveSession'>,
  sessionId: string,
): Promise<void> {
  await context.disposeLiveSession(sessionId);
}

async function copyNativeEntries(
  sourceStore: SessionTranscriptStore,
  targetStore: SessionTranscriptStore,
  sourceMessageId: string,
  targetMessageId: string,
): Promise<void> {
  const entries = await sourceStore.readNativeEntries(sourceMessageId);
  if (entries.length === 0) return;
  await targetStore.appendNativeEntries(
    targetMessageId,
    entries.map((entry, index) => ({ ordinal: index, entry })),
  );
}

/**
 * Copy the active compaction boundary after derived message ids are remapped.
 * A boundary anchored outside the retained fork prefix would make the target
 * replay a summary for history it does not contain, so it is deliberately
 * omitted in that case.
 */
async function copyDerivedCompaction(input: {
  source: SessionCompactionRecord | undefined;
  target: Pick<SessionTranscriptStore, 'recordCompaction'>;
  targetSessionId: string;
  messageIdMap: ReadonlyMap<string, string>;
}): Promise<SessionCompactionRecord | undefined> {
  const source = input.source;
  if (source === undefined) {
    return undefined;
  }

  const targetAnchor =
    source.anchorMessageId === null ? null : input.messageIdMap.get(source.anchorMessageId);
  if (targetAnchor === undefined) {
    return undefined;
  }

  await input.target.recordCompaction({
    compactionId: source.compactionId,
    anchorMessageId: targetAnchor,
    summary: source.summary,
    ...(source.firstKeptEntryId !== undefined ? { firstKeptEntryId: source.firstKeptEntryId } : {}),
    ...(source.tokensBefore !== undefined ? { tokensBefore: source.tokensBefore } : {}),
    ...(source.tokensAfter !== undefined ? { tokensAfter: source.tokensAfter } : {}),
    ...(source.runtimeGenerationId !== undefined
      ? { runtimeGenerationId: source.runtimeGenerationId }
      : {}),
    createdAt: source.createdAt,
  });
  return {
    ...source,
    sessionId: input.targetSessionId,
    anchorMessageId: targetAnchor,
  };
}
