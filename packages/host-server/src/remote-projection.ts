import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  HostCommand,
  ContextUsageSnapshot,
  HostMode,
  HostPush,
  HostResponse,
  RemoteCapabilitySummary,
  RemoteHostStatusData,
  RemoteMediaSaveData,
  RemoteProjectSummary,
  RemoteSessionScopeKind,
  RemoteSessionMessagesData,
  RemoteSessionListPageData,
  RemoteSessionOutlineNode,
  RemoteSessionResumeData,
  RemoteSessionSummary,
  RemoteSessionTranscriptPageData,
  RemoteSessionTranscriptPageInfo,
  RemoteTranscriptMessage,
} from '@piwin/contracts';

export type RemoteProjectionContext = {
  hostInstanceId: string;
  mode: HostMode;
  capabilities: RemoteCapabilitySummary;
};

export function projectRemoteResponse(
  command: HostCommand,
  response: HostResponse,
  context: RemoteProjectionContext,
): HostResponse {
  if (!response.success) {
    return {
      ...response,
      error: redactHostError(response.error),
    };
  }

  if (command.type === 'host/status') {
    return {
      ...response,
      data: projectRemoteStatusData(response.data, context),
    };
  }

  if (command.type === 'project/list') {
    return {
      ...response,
      data: { projects: projectProjects(response.data) },
    };
  }

  if (command.type === 'session/list') {
    return {
      ...response,
      data: { sessions: projectSessions(response.data) },
    };
  }

  if (command.type === 'session/list-page') {
    return {
      ...response,
      data: projectSessionListPage(response.data),
    };
  }

  if (command.type === 'session/messages') {
    return {
      ...response,
      data: projectSessionMessages(response.data),
    };
  }

  if (command.type === 'session/transcript-page') {
    return {
      ...response,
      data: projectSessionTranscriptPage(response.data),
    };
  }

  if (command.type === 'session/resume') {
    return {
      ...response,
      data: projectSessionResume(response.data),
    };
  }

  if (command.type === 'media/save') {
    return {
      ...response,
      data: projectRemoteMediaSaveData(response.data),
    };
  }

  if (command.type.startsWith('session/') || command.type === 'permission/resolve') {
    return {
      ...response,
      data: sanitizeRemoteValue(response.data, undefined),
    };
  }

  return response;
}

export function createRemoteCapabilities(): RemoteCapabilitySummary {
  return {
    pushSequencing: true,
    replay: true,
    snapshot: true,
    sessionRead: true,
    sessionControl: true,
    permissionResolve: true,
    mediaUpload: true,
    pushBatching: true,
    cursorBatches: true,
    boundedReplay: true,
    hydration: true,
  };
}

export function projectRemotePush(message: HostPush): HostPush {
  const projected = sanitizeRemoteValue(message, undefined);
  return (projected ?? message) as HostPush;
}

export function projectRemoteStatusData(
  data: unknown,
  context: RemoteProjectionContext,
): RemoteHostStatusData {
  const record = asRecord(data);
  const activeSessionIds = record?.activeSessionIds;
  const mode = record?.mode === 'sdk' || record?.mode === 'rpc' ? record.mode : context.mode;
  return {
    hostInstanceId: context.hostInstanceId,
    protocolVersion: 1,
    mode,
    ready: record?.ready === true,
    mock: record?.mock === true,
    activeSessionCount: Array.isArray(activeSessionIds) ? activeSessionIds.length : 0,
    capabilities: context.capabilities,
  };
}

function projectRemoteMediaSaveData(data: unknown): RemoteMediaSaveData {
  const asset = asRecord(asRecord(data)?.asset);
  const projected: RemoteMediaSaveData = {
    asset: {
      id: typeof asset?.id === 'string' ? asset.id : '',
      mimeType: typeof asset?.mimeType === 'string' ? asset.mimeType : 'application/octet-stream',
      byteSize: typeof asset?.byteSize === 'number' && asset.byteSize >= 0 ? asset.byteSize : 0,
    },
  };
  if (typeof asset?.width === 'number' && asset.width >= 0) {
    projected.asset.width = asset.width;
  }
  if (typeof asset?.height === 'number' && asset.height >= 0) {
    projected.asset.height = asset.height;
  }
  if (typeof asset?.name === 'string' && asset.name.length > 0) {
    projected.asset.name = asset.name;
  }
  if (
    asset?.contentKind === 'image' ||
    asset?.contentKind === 'text' ||
    asset?.contentKind === 'document'
  ) {
    projected.asset.contentKind = asset.contentKind;
  }
  return projected;
}

function projectProjects(data: unknown): RemoteProjectSummary[] {
  const projects = asRecord(data)?.projects;
  if (!Array.isArray(projects)) {
    return [];
  }

  const projected: RemoteProjectSummary[] = [];
  for (const project of projects) {
    const record = asRecord(project);
    if (record === undefined || typeof record.path !== 'string') {
      continue;
    }
    const displayName =
      typeof record.displayName === 'string' && record.displayName.trim().length > 0
        ? record.displayName
        : path.basename(record.path) || 'Project';
    const trust =
      record.trust === 'trusted' || record.trust === 'untrusted' ? record.trust : 'unknown';
    const summary: RemoteProjectSummary = {
      projectId: createProjectId(record.path),
      displayName,
      trust,
    };
    if (typeof record.lastOpenedAt === 'string') {
      summary.lastOpenedAt = record.lastOpenedAt;
    }
    projected.push(summary);
  }
  return projected;
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
    if (record.isPinned === true) {
      summary.pinned = true;
    }
    if (record.isArchived === true) {
      summary.archived = true;
    }
    projected.push(summary);
  }
  return projected;
}

function projectSessionListPage(data: unknown): RemoteSessionListPageData {
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
      // Opaque cursors are atomic. Truncation would turn a valid Host token
      // into a different invalid token, so oversize values are omitted.
      page.page.previousCursor = pageRecord.previousCursor;
    }
    if (typeof pageRecord?.nextCursor === 'string' && pageRecord.nextCursor.length <= 512) {
      page.page.nextCursor = pageRecord.nextCursor;
    }
  }
  return page;
}

function projectSessionMessages(data: unknown): RemoteSessionMessagesData {
  const record = asRecord(data);
  const sessionId = typeof record?.sessionId === 'string' ? record.sessionId : '';
  return { sessionId, messages: projectTranscriptMessages(record?.messages) };
}

function projectSessionResume(data: unknown): RemoteSessionResumeData {
  const record = asRecord(data);
  const sessionId = typeof record?.sessionId === 'string' ? record.sessionId : '';
  const resume: RemoteSessionResumeData = {
    sessionId,
    live: record?.live === true,
    messages: projectTranscriptMessages(record?.messages),
    scope: projectSessionScope(record?.scope),
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
  const model = asRecord(record?.model);
  if (
    model !== undefined &&
    typeof model.protocol === 'string' &&
    typeof model.providerId === 'string' &&
    typeof model.modelId === 'string'
  ) {
    resume.model = {
      protocol: model.protocol,
      providerId: model.providerId,
      modelId: model.modelId,
    };
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

function projectSessionTranscriptPage(data: unknown): RemoteSessionTranscriptPageData {
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
    messages: projectTranscriptMessages(record?.messages),
    page: projectSessionTranscriptPageInfo(record?.page) ?? {
      revision: '',
      totalCount: 0,
      startIndex: 0,
      endIndex: 0,
      messageBytes: 0,
    },
  };
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

function projectTranscriptMessages(messagesValue: unknown): RemoteTranscriptMessage[] {
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
    if (isTranscriptOutcome(item.outcome)) {
      transcript.outcome = item.outcome;
    }
    if (Array.isArray(item.attachments) && item.attachments.length > 0) {
      transcript.attachmentCount = item.attachments.length;
    }
    projected.push(transcript);
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

function createProjectId(projectPath: string): string {
  return `project-${createHash('sha256').update(projectPath).digest('hex').slice(0, 24)}`;
}

function copyString<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  sourceKey: string,
  target: T,
  targetKey: keyof T,
): void {
  const value = source[sourceKey];
  if (typeof value === 'string' && value.length > 0) {
    target[targetKey] = value as T[keyof T];
  }
}

function copyNumber<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  sourceKey: string,
  target: T,
  targetKey: keyof T,
): void {
  const value = source[sourceKey];
  if (typeof value === 'number' && Number.isFinite(value)) {
    target[targetKey] = value as T[keyof T];
  }
}

function copyBoundedString<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  sourceKey: string,
  target: T,
  targetKey: keyof T,
  maxBytes: number,
): void {
  const value = source[sourceKey];
  if (typeof value === 'string' && value.length > 0) {
    target[targetKey] = boundedString(value, maxBytes) as T[keyof T];
  }
}

function boundedString(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) {
    return value;
  }
  return `${value.slice(0, Math.max(0, Math.floor(maxBytes / 2)))}…`;
}

function safeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isAgentMessageRole(value: unknown): value is RemoteTranscriptMessage['role'] {
  return value === 'user' || value === 'assistant' || value === 'system' || value === 'tool';
}

function isTranscriptStatus(value: unknown): value is RemoteTranscriptMessage['status'] {
  return value === 'streaming' || value === 'done' || value === 'error';
}

function isTranscriptOutcome(
  value: unknown,
): value is NonNullable<RemoteTranscriptMessage['outcome']> {
  return value === 'completed' || value === 'cancelled' || value === 'failed';
}

function redactHostError(error: string): string {
  return error.replace(/(?:\/Users\/|\/home\/|[A-Za-z]:[\\/])[^\s'"`]+/g, '[host-path]');
}

const REMOTE_PATH_KEYS = new Set([
  'absolutePath',
  'changedPaths',
  'cwd',
  'path',
  'piwinRoot',
  'projectPath',
  'sourcePath',
  'targetPaths',
  'worktreePath',
]);

const REMOTE_SECRET_KEYS = new Set([
  'apiKey',
  'base64Data',
  'dataUrl',
  'password',
  'secret',
  'token',
]);

function sanitizeRemoteValue(value: unknown, key: string | undefined): unknown {
  if (key !== undefined && REMOTE_SECRET_KEYS.has(key)) {
    return '[redacted]';
  }
  if (key !== undefined && REMOTE_PATH_KEYS.has(key)) {
    return Array.isArray(value) ? [] : '[host-path]';
  }
  if (typeof value === 'string') {
    return boundedString(value, 256_000);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeRemoteValue(item, undefined));
  }
  const record = asRecord(value);
  if (record === undefined) {
    return value;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(record)) {
    const projected = sanitizeRemoteValue(childValue, childKey);
    if (projected !== undefined) {
      sanitized[childKey] = projected;
    }
  }
  return sanitized;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
