import type {
  AssistantUsageMeasurement,
  ContextUsageSnapshot,
  MediaAttachmentRef,
  ModelRef,
  RemoteSessionListData,
  RemoteSessionListPageData,
  RemoteSessionMessagesData,
  RemoteSessionOutlineNode,
  RemoteSessionResumeData,
  RemoteSessionScopeKind,
  RemoteSessionSummary,
  RemoteSessionTranscriptPageData,
  RemoteSessionTranscriptPageInfo,
  RemoteTranscriptMessage,
  SessionContextSnapshot,
} from '@piwin/contracts';
import {
  createUnknownSessionContextSnapshot,
  parseAssistantUsageMeasurement,
  parseSessionContextSnapshot,
  parseSessionStorageInfo,
  projectRemoteSessionStorage,
} from '@piwin/contracts';
import { createRemoteProjectId } from '@piwin/host-runtime';
import { projectRemoteTranscriptTools } from './remote-transcript-tool-projection.js';
import {
  asRecord,
  boundedString,
  copyBoundedString,
  copyNumber,
  copyString,
  isAgentMessageRole,
  isRemoteAssetRef,
  isTranscriptOutcome,
  isTranscriptStatus,
  projectRemoteMediaRef,
  safeNonNegativeInteger,
} from './remote-projection-helpers.js';

export function projectSessionList(data: unknown): RemoteSessionListData {
  const record = asRecord(data);
  const sessions = projectSessions(data);
  const totalCount =
    typeof record?.totalCount === 'number' &&
    Number.isSafeInteger(record.totalCount) &&
    record.totalCount >= 0
      ? record.totalCount
      : sessions.length;
  return {
    sessions,
    totalCount,
    truncated: record?.truncated === true,
  };
}

/** Path-free session object for remote index pushes. Desktop maps `projectId` as the project key. */
export function projectHostSessionForRemoteClient(
  session: unknown,
): Record<string, unknown> | undefined {
  const [projected] = projectSessions({ sessions: [session] });
  if (projected === undefined) {
    return undefined;
  }
  const mapped: Record<string, unknown> = {
    id: projected.sessionId,
    sessionId: projected.sessionId,
    scope: projected.scope,
  };
  if (projected.name !== undefined) mapped.name = projected.name;
  if (projected.kind !== undefined) mapped.kind = projected.kind;
  if (projected.updatedAt !== undefined) mapped.updatedAt = projected.updatedAt;
  if (projected.lastPreview !== undefined) mapped.lastPreview = projected.lastPreview;
  if (projected.messageCount !== undefined) mapped.messageCount = projected.messageCount;
  if (projected.pinned !== undefined) mapped.isPinned = projected.pinned;
  if (projected.archived !== undefined) mapped.isArchived = projected.archived;
  if (projected.knowledgeBaseIds !== undefined) mapped.knowledgeBaseIds = projected.knowledgeBaseIds;
  if (projected.subagentStatus !== undefined) mapped.subagentStatus = projected.subagentStatus;
  if (projected.task !== undefined) mapped.task = projected.task;
  if (projected.subagentRole !== undefined) mapped.subagentRole = projected.subagentRole;
  if (projected.subagentModel !== undefined) mapped.subagentModel = projected.subagentModel;
  if (projected.projectId !== undefined) mapped.projectId = projected.projectId;
  if (projected.storage !== undefined) mapped.storage = projected.storage;
  if (projected.scope === 'project' && projected.projectId) {
    mapped.scope = { kind: 'project', projectPath: projected.projectId };
  } else if (projected.scope === 'general') {
    mapped.scope = { kind: 'general' };
  }
  return mapped;
}

export function projectSessionListPage(data: unknown): RemoteSessionListPageData {
  const record = asRecord(data);
  if (record?.status === 'stale-cursor') {
    return {
      status: 'stale-cursor',
      currentRevision: typeof record.currentRevision === 'string' ? record.currentRevision : '',
    };
  }

  const pageRecord = asRecord(record?.page);
  const page: RemoteSessionListPageData = {
    status: 'page',
    sessions: projectSessions({ sessions: record?.sessions }),
    page: {
      revision: typeof pageRecord?.revision === 'string' ? pageRecord.revision : '',
      pageIndex: safeNonNegativeInteger(pageRecord?.pageIndex),
      pageCount: safeNonNegativeInteger(pageRecord?.pageCount),
      totalCount: safeNonNegativeInteger(pageRecord?.totalCount),
    },
  };
  if (page.status === 'page') {
    if (typeof pageRecord?.previousCursor === 'string' && pageRecord.previousCursor.length <= 512) {
      page.page.previousCursor = pageRecord.previousCursor;
    }
    if (typeof pageRecord?.nextCursor === 'string' && pageRecord.nextCursor.length <= 512) {
      page.page.nextCursor = pageRecord.nextCursor;
    }
  }
  return page;
}

export function projectSessionMessages(
  data: unknown,
  context: { remoteMediaPaths?: ReadonlyMap<string, string> },
): RemoteSessionMessagesData {
  const record = asRecord(data);
  const sessionId = typeof record?.sessionId === 'string' ? record.sessionId : '';
  return {
    sessionId,
    messages: projectTranscriptMessages(record?.messages, context.remoteMediaPaths),
  };
}

export function projectSessionResume(
  data: unknown,
  context: { remoteMediaPaths?: ReadonlyMap<string, string> },
): RemoteSessionResumeData {
  const record = asRecord(data);
  const sessionId = typeof record?.sessionId === 'string' ? record.sessionId : '';
  const resume: RemoteSessionResumeData = {
    sessionId,
    live: record?.live === true,
    messages: projectTranscriptMessages(record?.messages, context.remoteMediaPaths),
    scope: projectSessionScope(record?.scope),
    contextSnapshot: projectContextSnapshot(record?.contextSnapshot, sessionId),
    lastRequestUsage: projectLastRequestUsage(record?.lastRequestUsage),
  };
  const transcriptPage = projectSessionTranscriptPageInfo(record?.transcriptPage);
  if (transcriptPage !== undefined) {
    resume.transcriptPage = transcriptPage;
  }
  copyBoundedString(record ?? {}, 'name', resume, 'name', 512);
  copyBoundedString(record ?? {}, 'thinkingLevel', resume, 'thinkingLevel', 64);
  const contextUsage = projectContextUsage(record?.contextUsage, sessionId);
  if (contextUsage !== undefined) {
    resume.contextUsage = contextUsage;
  }
  const projectedModel = projectModelRef(record?.model);
  if (projectedModel !== undefined) {
    resume.model = projectedModel;
  }
  const outline = Array.isArray(record?.outline) ? record.outline : [];
  const projectedOutline: RemoteSessionOutlineNode[] = [];
  for (const item of outline) {
    const outlineItem = asRecord(item);
    if (
      outlineItem === undefined ||
      typeof outlineItem.id !== 'string' ||
      !isAgentMessageRole(outlineItem.role) ||
      typeof outlineItem.createdAt !== 'string'
    ) {
      continue;
    }
    projectedOutline.push({
      id: outlineItem.id,
      role: outlineItem.role,
      preview: boundedString(outlineItem.preview, 8_192),
      createdAt: outlineItem.createdAt,
    });
  }
  if (projectedOutline.length > 0) {
    resume.outline = projectedOutline;
  }
  return resume;
}

export function projectSessionTranscriptPage(
  data: unknown,
  context: { remoteMediaPaths?: ReadonlyMap<string, string> },
): RemoteSessionTranscriptPageData {
  const record = asRecord(data);
  if (record?.status === 'stale-cursor') {
    return {
      status: 'stale-cursor',
      currentRevision:
        typeof record.currentRevision === 'string'
          ? boundedString(record.currentRevision, 128)
          : '',
    };
  }
  return {
    status: 'page',
    messages: projectTranscriptMessages(record?.messages, context.remoteMediaPaths),
    page: projectSessionTranscriptPageInfo(record?.page) ?? {
      revision: '',
      totalCount: 0,
      startIndex: 0,
      endIndex: 0,
      messageBytes: 0,
    },
  };
}

export function projectSessionUserMessageIndex(data: unknown): unknown {
  const record = asRecord(data);
  if (record === undefined) return data;
  const rawAnchors = Array.isArray(record.anchors) ? record.anchors : [];
  const anchors: Array<Record<string, unknown>> = [];
  for (const item of rawAnchors) {
    const anchor = asRecord(item);
    if (
      anchor === undefined ||
      typeof anchor.messageId !== 'string' ||
      typeof anchor.createdAt !== 'string' ||
      typeof anchor.ordinal !== 'number' ||
      !Number.isSafeInteger(anchor.ordinal)
    ) {
      continue;
    }
    if (anchors.length >= 256) break;
    anchors.push({
      messageId: boundedString(anchor.messageId, 512),
      createdAt: boundedString(anchor.createdAt, 128),
      ordinal: anchor.ordinal,
      preview: boundedString(anchor.preview, 512),
      spanStartOrdinal:
        typeof anchor.spanStartOrdinal === 'number' && Number.isSafeInteger(anchor.spanStartOrdinal)
          ? anchor.spanStartOrdinal
          : anchor.ordinal,
      spanEndOrdinal:
        typeof anchor.spanEndOrdinal === 'number' && Number.isSafeInteger(anchor.spanEndOrdinal)
          ? anchor.spanEndOrdinal
          : anchor.ordinal,
    });
  }
  const dropped = rawAnchors.length > anchors.length;
  const mode = record.mode === 'exact' && !dropped ? 'exact' : 'sampled';
  const anchorBytes = new TextEncoder().encode(JSON.stringify(anchors)).byteLength;
  return {
    sessionId: typeof record.sessionId === 'string' ? boundedString(record.sessionId, 256) : '',
    revision: typeof record.revision === 'string' ? boundedString(record.revision, 128) : '',
    totalUserMessages:
      typeof record.totalUserMessages === 'number' && Number.isSafeInteger(record.totalUserMessages)
        ? record.totalUserMessages
        : 0,
    mode,
    anchors,
    anchorBytes,
  };
}

function projectContextSnapshot(value: unknown, sessionId: string): SessionContextSnapshot {
  const parsed = parseSessionContextSnapshot(value);
  if (parsed !== null) {
    return parsed;
  }
  return createUnknownSessionContextSnapshot({
    sessionId,
    revision: 1,
    contextVersion: 1,
    contextBoundary: { activeLeafMessageId: null },
    reason: 'never-sampled',
    updatedAt: new Date().toISOString(),
  });
}

function projectLastRequestUsage(value: unknown): AssistantUsageMeasurement | null {
  if (value === null || value === undefined) {
    return null;
  }
  return parseAssistantUsageMeasurement(value);
}

function projectSessions(data: unknown): RemoteSessionSummary[] {
  const sessions = asRecord(data)?.sessions;
  if (!Array.isArray(sessions)) {
    return [];
  }

  const projected: RemoteSessionSummary[] = [];
  for (const session of sessions) {
    const record = asRecord(session);
    if (record === undefined || typeof record.id !== 'string') {
      continue;
    }
    const summary: RemoteSessionSummary = {
      sessionId: record.id,
      scope: projectSessionScope(record.scope),
    };
    copyString(record, 'name', summary, 'name');
    copyString(record, 'kind', summary, 'kind');
    copyString(record, 'updatedAt', summary, 'updatedAt');
    copyString(record, 'lastPreview', summary, 'lastPreview');
    copyString(record, 'parentSessionId', summary, 'parentSessionId');
    copyNumber(record, 'messageCount', summary, 'messageCount');
    if (record.isPinned === true || record.isPinned === false) {
      summary.pinned = record.isPinned;
    }
    if (record.isArchived === true || record.isArchived === false) {
      summary.archived = record.isArchived;
    }
    if (Array.isArray(record.knowledgeBaseIds)) {
      const ids = record.knowledgeBaseIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256,
      );
      if (ids.length > 0) summary.knowledgeBaseIds = ids.slice(0, 32);
    }
    if (
      record.subagentStatus === 'running' ||
      record.subagentStatus === 'done' ||
      record.subagentStatus === 'failed' ||
      record.subagentStatus === 'cancelled'
    ) {
      summary.subagentStatus = record.subagentStatus;
    }
    copyBoundedString(record, 'task', summary, 'task', 1_000);
    copyBoundedString(record, 'subagentRole', summary, 'subagentRole', 256);
    const subagentModel = projectModelRef(record.subagentModel);
    if (subagentModel !== undefined) summary.subagentModel = subagentModel;
    if (scopeIsProject(record)) {
      const projectPath = projectPathFromSessionRecord(record);
      if (projectPath !== undefined) {
        summary.projectId = createRemoteProjectId(projectPath);
      }
    }
    const storage = projectRemoteSessionStorage(parseSessionStorageInfo(record.storage));
    if (storage) {
      summary.storage = storage;
    }
    projected.push(summary);
  }
  return projected;
}

function projectContextUsage(
  value: unknown,
  fallbackSessionId: string,
): ContextUsageSnapshot | undefined {
  const record = asRecord(value);
  if (record === undefined || typeof record.updatedAt !== 'string') {
    return undefined;
  }
  const usage: ContextUsageSnapshot = {
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : fallbackSessionId,
    updatedAt: boundedString(record.updatedAt, 128),
  };
  copyUsageNumber(record, usage, 'tokensUsed');
  copyUsageNumber(record, usage, 'tokensLimit');
  copyUsageNumber(record, usage, 'promptTokens');
  copyUsageNumber(record, usage, 'completionTokens');
  copyUsageNumber(record, usage, 'cacheReadTokens');
  copyUsageNumber(record, usage, 'cacheWriteTokens');
  copyUsageNumber(record, usage, 'totalTokens');
  copyUsageNumber(record, usage, 'contextRatio');
  if (typeof record.modelId === 'string') {
    usage.modelId = boundedString(record.modelId, 512);
  }
  if (
    record.source === 'pi-contextUsage' ||
    record.source === 'assistant-usage' ||
    record.source === 'host-estimate'
  ) {
    usage.source = record.source;
  }
  return usage;
}

function copyUsageNumber(
  source: Record<string, unknown>,
  target: ContextUsageSnapshot,
  key:
    | 'tokensUsed'
    | 'tokensLimit'
    | 'promptTokens'
    | 'completionTokens'
    | 'cacheReadTokens'
    | 'cacheWriteTokens'
    | 'totalTokens'
    | 'contextRatio',
): void {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    target[key] = value;
  }
}

function projectSessionTranscriptPageInfo(
  value: unknown,
): RemoteSessionTranscriptPageInfo | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const info: RemoteSessionTranscriptPageInfo = {
    revision: typeof record.revision === 'string' ? boundedString(record.revision, 128) : '',
    totalCount: safeNonNegativeInteger(record.totalCount),
    startIndex: safeNonNegativeInteger(record.startIndex),
    endIndex: safeNonNegativeInteger(record.endIndex),
    messageBytes: safeNonNegativeInteger(record.messageBytes),
  };
  if (typeof record.olderCursor === 'string' && record.olderCursor.length <= 512) {
    info.olderCursor = record.olderCursor;
  }
  if (Array.isArray(record.truncatedMessageIds)) {
    const ids = record.truncatedMessageIds
      .filter((item): item is string => typeof item === 'string' && item.length <= 256)
      .slice(0, 50);
    if (ids.length > 0) info.truncatedMessageIds = ids;
  }
  return info;
}

const MAX_REMOTE_TRANSCRIPT_ATTACHMENTS = 16;

function projectTranscriptMessages(
  messagesValue: unknown,
  remoteMediaPaths?: ReadonlyMap<string, string>,
): RemoteTranscriptMessage[] {
  const messages = Array.isArray(messagesValue) ? messagesValue : [];
  const projected: RemoteTranscriptMessage[] = [];
  for (const message of messages) {
    const item = asRecord(message);
    if (
      item === undefined ||
      typeof item.id !== 'string' ||
      !isAgentMessageRole(item.role) ||
      typeof item.createdAt !== 'string' ||
      !isTranscriptStatus(item.status)
    ) {
      continue;
    }
    const transcript: RemoteTranscriptMessage = {
      id: item.id,
      role: item.role,
      text: boundedString(item.text, 512_000),
      createdAt: item.createdAt,
      status: item.status,
    };
    copyBoundedString(item, 'runId', transcript, 'runId', 256);
    copyBoundedString(item, 'startedAt', transcript, 'startedAt', 128);
    copyBoundedString(item, 'endedAt', transcript, 'endedAt', 128);
    copyBoundedString(item, 'terminalMessage', transcript, 'terminalMessage', 16_384);
    copyBoundedString(item, 'thinking', transcript, 'thinking', 128_000);
    const model = projectModelRef(item.model);
    if (model !== undefined) {
      transcript.model = model;
    }
    if (isTranscriptOutcome(item.outcome)) {
      transcript.outcome = item.outcome;
    }
    const attachments = projectRemoteTranscriptAttachments(item.attachments, remoteMediaPaths);
    if (attachments.length > 0) {
      transcript.attachments = attachments;
      transcript.attachmentCount = attachments.length;
    } else if (Array.isArray(item.attachments) && item.attachments.length > 0) {
      transcript.attachmentCount = Math.min(
        item.attachments.length,
        MAX_REMOTE_TRANSCRIPT_ATTACHMENTS,
      );
    }
    const delivery = asRecord(item.instructionDelivery);
    if (
      delivery !== undefined &&
      (delivery.kind === 'run-intervention' || delivery.kind === 'queued-turn') &&
      typeof delivery.instructionId === 'string' &&
      typeof delivery.revision === 'number' &&
      typeof delivery.status === 'string'
    ) {
      transcript.instructionDelivery = {
        kind: delivery.kind,
        instructionId: delivery.instructionId,
        status: delivery.status as NonNullable<
          RemoteTranscriptMessage['instructionDelivery']
        >['status'],
        revision: delivery.revision,
        ...(typeof delivery.targetRunId === 'string' ? { targetRunId: delivery.targetRunId } : {}),
      };
    }
    const tools = projectRemoteTranscriptTools(item.tools);
    if (tools.length > 0) {
      transcript.tools = tools;
    }
    projected.push(transcript);
  }
  return projected;
}

function projectModelRef(value: unknown): ModelRef | undefined {
  const record = asRecord(value);
  if (
    record === undefined ||
    typeof record.providerId !== 'string' ||
    record.providerId.trim().length === 0 ||
    record.providerId.length > 256 ||
    typeof record.modelId !== 'string' ||
    record.modelId.trim().length === 0 ||
    record.modelId.length > 512
  ) {
    return undefined;
  }
  const model: ModelRef = {
    providerId: record.providerId,
    modelId: record.modelId,
  };
  if (
    record.protocol === 'openai-compatible' ||
    record.protocol === 'anthropic-compatible' ||
    record.protocol === 'google-gemini'
  ) {
    model.protocol = record.protocol;
  }
  if (record.source === 'channel' || record.source === 'subscription') {
    model.source = record.source;
  }
  return model;
}

const MEDIA_ATTACHMENT_SOURCES = new Set(['paste', 'drop', 'file-picker', 'generated']);

export function projectRemoteTranscriptAttachments(
  attachmentsValue: unknown,
  remoteMediaPaths: ReadonlyMap<string, string> | undefined,
): MediaAttachmentRef[] {
  if (!Array.isArray(attachmentsValue)) {
    return [];
  }
  const projected: MediaAttachmentRef[] = [];
  for (const entry of attachmentsValue) {
    if (projected.length >= MAX_REMOTE_TRANSCRIPT_ATTACHMENTS) {
      break;
    }
    const attachment = asRecord(entry);
    if (
      attachment === undefined ||
      attachment.kind !== 'media' ||
      typeof attachment.id !== 'string' ||
      attachment.id.length === 0 ||
      attachment.id.length > 256 ||
      /[\\/\u0000-\u001f]/.test(attachment.id) ||
      typeof attachment.mimeType !== 'string' ||
      typeof attachment.byteSize !== 'number' ||
      !Number.isFinite(attachment.byteSize) ||
      attachment.byteSize < 0 ||
      typeof attachment.source !== 'string' ||
      !MEDIA_ATTACHMENT_SOURCES.has(attachment.source)
    ) {
      continue;
    }
    let path = `remote-asset:${attachment.id}`;
    if (typeof attachment.path === 'string' && attachment.path.length > 0) {
      if (isRemoteAssetRef(attachment.path)) {
        path = attachment.path;
      } else {
        const mapped = projectRemoteMediaRef(attachment.path, remoteMediaPaths);
        if (isRemoteAssetRef(mapped)) {
          path = mapped;
        }
      }
    }
    const next: MediaAttachmentRef = {
      id: attachment.id,
      kind: 'media',
      path,
      mimeType: boundedString(attachment.mimeType, 128),
      byteSize: Math.floor(attachment.byteSize),
      source: attachment.source as MediaAttachmentRef['source'],
    };
    if (typeof attachment.name === 'string' && attachment.name.trim().length > 0) {
      next.name = boundedString(attachment.name.trim(), 512);
    }
    if (
      attachment.contentKind === 'image' ||
      attachment.contentKind === 'text' ||
      attachment.contentKind === 'document'
    ) {
      next.contentKind = attachment.contentKind;
    }
    if (typeof attachment.width === 'number' && Number.isFinite(attachment.width)) {
      next.width = Math.floor(attachment.width);
    }
    if (typeof attachment.height === 'number' && Number.isFinite(attachment.height)) {
      next.height = Math.floor(attachment.height);
    }
    projected.push(next);
  }
  return projected;
}

function projectSessionScope(value: unknown): RemoteSessionScopeKind {
  const scope = asRecord(value);
  if (scope?.kind === 'project') {
    return 'project';
  }
  if (scope?.kind === 'general') {
    return 'general';
  }
  return 'unknown';
}

function scopeIsProject(record: Record<string, unknown>): boolean {
  return projectSessionScope(record.scope) === 'project';
}

function projectPathFromSessionRecord(record: Record<string, unknown>): string | undefined {
  const scope = asRecord(record.scope);
  if (typeof scope?.projectPath === 'string' && scope.projectPath.length > 0) {
    return scope.projectPath;
  }
  if (typeof record.projectPath === 'string' && record.projectPath.length > 0) {
    return record.projectPath;
  }
  return undefined;
}
