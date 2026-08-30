import path from 'node:path';
import type {
  HostCommand,
  ContextUsageSnapshot,
  HostMode,
  HostPush,
  HostResponse,
  MediaAttachmentRef,
  RemoteCapabilitySummary,
  RemoteHostStatusData,
  RemoteMediaSaveData,
  RemoteProjectSummary,
  RemoteSessionScopeKind,
  RemoteSessionMessagesData,
  RemoteSessionListData,
  RemoteSessionListPageData,
  RemoteSessionOutlineNode,
  RemoteSessionResumeData,
  RemoteSessionSummary,
  RemoteSessionTranscriptPageData,
  RemoteSessionTranscriptPageInfo,
  RemoteTranscriptMessage,
  QueuedTurnRecord,
} from '@piwin/contracts';
import {
  hostOsFamilyFromNodePlatform,
  hostPathStyleFromOsFamily,
  parseSessionStorageInfo,
  projectRemoteSessionStorage,
  readActivitySummaryData,
  REDACTED_STORED_SECRET,
} from '@piwin/contracts';
import { createRemoteProjectId, isRemoteProjectId } from '@piwin/host-runtime';
import { projectConfiguredChatModelsResponse } from './remote-configured-models.js';
import { redactRemoteHostPaths } from './remote-redact.js';
import { projectRemoteTranscriptTools } from './remote-transcript-tool-projection.js';
import { projectRemoteLiveResponse } from './remote-live-projection.js';

export { redactRemoteHostPaths };

export type RemoteProjectionContext = {
  hostInstanceId: string;
  mode: HostMode;
  capabilities: RemoteCapabilitySummary;
  /** Host media id → absolute path, used to restore opaque client refs. */
  remoteMediaPaths?: ReadonlyMap<string, string>;
  /** Local loopback Desktop may keep one-shot Live start bootstrap. */
  liveOwner?: boolean;
};

export function projectRemoteResponse(
  command: HostCommand,
  response: HostResponse,
  context: RemoteProjectionContext,
): HostResponse {
  const live = projectRemoteLiveResponse(
    command,
    response,
    context.liveOwner === true ? { owner: true } : {},
  );
  if (live) return live;
  if (!response.success) {
    return {
      ...response,
      error: redactHostError(response.error),
    };
  }
  if (command.type === 'host/status') {
    return { ...response, data: projectRemoteStatusData(response.data, context) };
  }
  if (command.type === 'activity/summary') {
    return { ...response, data: readActivitySummaryData(response.data) };
  }
  if (command.type === 'project/list') {
    return {
      ...response,
      data: { projects: projectProjects(response.data) },
    };
  }
  if (command.type === 'project/open' || command.type === 'project/trust') {
    return {
      ...response,
      data: projectProjectMutation(response.data),
    };
  }

  if (command.type === 'session/list') {
    return {
      ...response,
      data: projectSessionList(response.data),
    };
  }

  if (command.type === 'models/configured') {
    return {
      ...response,
      data: projectConfiguredChatModelsResponse(response.data),
    };
  }

  if (command.type === 'settings/get') {
    return {
      ...response,
      data: projectRemoteSettingsData(response.data),
    };
  }

  if (command.type === 'settings/apply') {
    return {
      ...response,
      data: projectRemoteSettingsApplyData(response.data),
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
      data: projectSessionMessages(response.data, context),
    };
  }

  if (command.type === 'session/transcript-page') {
    return {
      ...response,
      data: projectSessionTranscriptPage(response.data, context),
    };
  }

  if (command.type === 'session/resume') {
    return {
      ...response,
      data: projectSessionResume(response.data, context),
    };
  }

  if (command.type === 'media/save' || command.type === 'media/save-finish') {
    return {
      ...response,
      data: projectRemoteMediaSaveData(response.data),
    };
  }

  if (command.type === 'media/read') {
    // MediaReadData is path-free by contract (logical ids + base64 bytes);
    // passing it through untouched also keeps the sanitizer from
    // regex-scanning multi-megabyte base64 payloads.
    return response;
  }

  if (command.type === 'media/list') {
    return {
      ...response,
      data: projectRemoteMediaListData(response.data),
    };
  }

  if (command.type === 'preview/read-trusted-text') {
    // TrustedTextReadData is already path-free (relativePath + text).
    return response;
  }

  if (
    command.type === 'session/queued-turn-submit' ||
    command.type === 'session/queued-turn-list' ||
    command.type === 'session/queued-turn-edit' ||
    command.type === 'session/queued-turn-cancel' ||
    command.type === 'session/queued-turn-reorder' ||
    command.type === 'session/replace-run' ||
    // Adoption responses echo the cancelled queued turn alongside the
    // intervention; the record must go through the same media-path scrub.
    command.type === 'run/intervention-submit'
  ) {
    return {
      ...response,
      data: projectRemoteQueuedTurnData(response.data, context),
    };
  }

  if (command.type === 'skills/read') {
    return {
      ...response,
      data: projectRemoteSkillsReadData(response.data),
    };
  }

  if (command.type === 'session/tool-output') {
    return {
      ...response,
      data: projectRemoteToolOutputData(response.data),
    };
  }

  if (command.type === 'session/user-message-index') {
    return {
      ...response,
      data: projectSessionUserMessageIndex(response.data),
    };
  }

  if (
    command.type.startsWith('session/') ||
    command.type.startsWith('run/') ||
    command.type.startsWith('plan/') ||
    command.type.startsWith('walkthrough/') ||
    command.type.startsWith('extension/') ||
    command.type.startsWith('extensions/') ||
    command.type.startsWith('notes/') ||
    command.type.startsWith('flashcards/') ||
    command.type.startsWith('usage/') ||
    command.type.startsWith('skills/') ||
    command.type.startsWith('prompts/') ||
    command.type === 'host/runtime-resources' ||
    command.type === 'permission/resolve' ||
    command.type === 'permission/pending-list'
  ) {
    return {
      ...response,
      data: sanitizeRemoteValue(response.data, undefined),
    };
  }

  return response;
}

export function createRemoteCapabilities(
  allowedCommands?: Iterable<HostCommand['type']>,
): RemoteCapabilitySummary {
  const platform = hostOsFamilyFromNodePlatform(process.platform);
  return {
    ...(allowedCommands === undefined
      ? {}
      : { allowedCommands: [...new Set(allowedCommands)].sort() }),
    platform,
    pathStyle: hostPathStyleFromOsFamily(platform),
    pushSequencing: true,
    replay: true,
    snapshot: true,
    sessionRead: true,
    sessionControl: true,
    sessionPause: true,
    permissionResolve: true,
    mediaUpload: true,
    mediaRead: true,
    trustedTextPreview: true,
    pushBatching: true,
    cursorBatches: true,
    boundedReplay: true,
    hydration: true,
    skillPreview: true,
    toolOutputRead: true,
    sessionUserMessageIndex: true,
    sessionTranscriptSeek: true,
    contextSummary: true,
    runInterventions: true,
    queuedTurns: true,
    foregroundRunAdmission: true,
    logicalProjectRefs: true,
    activityHydration: true,
    liveSubscriptions: true,
  };
}

export function projectRemotePush(
  message: HostPush,
  context?: Pick<RemoteProjectionContext, 'remoteMediaPaths'>,
): HostPush {
  const projected =
    message.type === 'session/queued-turn-updated'
      ? projectRemoteQueuedTurnPush(message, context?.remoteMediaPaths)
      : sanitizeRemoteValue(message, undefined);
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

function projectRemoteMediaListData(data: unknown): {
  items: Array<{
    assetId: string;
    sessionId: string;
    mimeType: string;
    byteSize: number;
    createdAt: string;
    kind: 'image' | 'video' | 'file';
    name?: string;
    prompt?: string;
    model?: string;
    hasThumb?: boolean;
  }>;
  total: number;
  nextCursor?: string;
} {
  const record = asRecord(data);
  const rawItems = Array.isArray(record?.items) ? record.items : [];
  const items: Array<{
    assetId: string;
    sessionId: string;
    mimeType: string;
    byteSize: number;
    createdAt: string;
    kind: 'image' | 'video' | 'file';
    name?: string;
    prompt?: string;
    model?: string;
    hasThumb?: boolean;
  }> = [];
  for (const entry of rawItems) {
    const item = asRecord(entry);
    if (
      item === undefined ||
      typeof item.assetId !== 'string' ||
      typeof item.sessionId !== 'string' ||
      typeof item.mimeType !== 'string' ||
      typeof item.createdAt !== 'string' ||
      (item.kind !== 'image' && item.kind !== 'video' && item.kind !== 'file')
    ) {
      continue;
    }
    const projected: (typeof items)[number] = {
      assetId: item.assetId,
      sessionId: item.sessionId,
      mimeType: item.mimeType,
      byteSize: typeof item.byteSize === 'number' && item.byteSize >= 0 ? item.byteSize : 0,
      createdAt: item.createdAt,
      kind: item.kind,
    };
    if (typeof item.prompt === 'string' && item.prompt.trim()) {
      projected.prompt = item.prompt;
    }
    if (typeof item.model === 'string' && item.model.trim()) {
      projected.model = item.model;
    }
    if (typeof item.name === 'string' && item.name.trim()) {
      projected.name = item.name;
    }
    if (item.hasThumb === true) {
      projected.hasThumb = true;
    }
    items.push(projected);
  }
  const projected: {
    items: typeof items;
    total: number;
    nextCursor?: string;
  } = {
    items,
    total: typeof record?.total === 'number' && record.total >= 0 ? record.total : items.length,
  };
  if (typeof record?.nextCursor === 'string' && record.nextCursor.length > 0) {
    projected.nextCursor = record.nextCursor;
  }
  return projected;
}

function projectProjectMutation(data: unknown): {
  projectId: string;
  trusted: boolean;
  trust: 'trusted' | 'untrusted';
} {
  const record = asRecord(data);
  const issuedId = typeof record?.projectId === 'string' ? record.projectId : '';
  const hostPath = typeof record?.path === 'string' ? record.path : '';
  const projectId = isRemoteProjectId(issuedId)
    ? issuedId
    : hostPath
      ? createRemoteProjectId(hostPath)
      : '';
  const trusted = record?.trusted === true || record?.trust === 'trusted';
  return {
    projectId,
    trusted,
    trust: trusted ? 'trusted' : 'untrusted',
  };
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
      projectId: createRemoteProjectId(record.path),
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

function projectSessionList(data: unknown): RemoteSessionListData {
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

function projectSessionMessages(
  data: unknown,
  context: Pick<RemoteProjectionContext, 'remoteMediaPaths'>,
): RemoteSessionMessagesData {
  const record = asRecord(data);
  const sessionId = typeof record?.sessionId === 'string' ? record.sessionId : '';
  return {
    sessionId,
    messages: projectTranscriptMessages(record?.messages, context.remoteMediaPaths),
  };
}

function projectSessionResume(
  data: unknown,
  context: Pick<RemoteProjectionContext, 'remoteMediaPaths'>,
): RemoteSessionResumeData {
  const record = asRecord(data);
  const sessionId = typeof record?.sessionId === 'string' ? record.sessionId : '';
  const resume: RemoteSessionResumeData = {
    sessionId,
    live: record?.live === true,
    messages: projectTranscriptMessages(record?.messages, context.remoteMediaPaths),
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

function projectSessionTranscriptPage(
  data: unknown,
  context: Pick<RemoteProjectionContext, 'remoteMediaPaths'>,
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
    if (isTranscriptOutcome(item.outcome)) {
      transcript.outcome = item.outcome;
    }
    const attachments = projectRemoteTranscriptAttachments(item.attachments, remoteMediaPaths);
    if (attachments.length > 0) {
      transcript.attachments = attachments;
      transcript.attachmentCount = attachments.length;
    } else if (Array.isArray(item.attachments) && item.attachments.length > 0) {
      // Preserve count even when individual rows fail validation, so older
      // clients still know media existed on the turn.
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

const MEDIA_ATTACHMENT_SOURCES = new Set(['paste', 'drop', 'file-picker', 'generated']);

/** Rewrite vault paths to opaque refs so resume/history can still thumb via media/read. */
function projectRemoteTranscriptAttachments(
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
    // Prefer the durable asset id. remoteMediaPaths may be cold after a Host
    // restart; media/read still resolves by sessionId + assetId on disk.
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
  return redactRemoteHostPaths(error);
}

const REMOTE_PATH_KEYS = new Set([
  'absolutePath',
  'changedPaths',
  'cwd',
  'directory',
  'entryPath',
  'extraPaths',
  'outputPath',
  'packPath',
  'path',
  'piwinRoot',
  'projectPath',
  'root',
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
  'offerSdp',
  'answerSdp',
  'sdpOffer',
  'sdpAnswer',
  'ephemeralToken',
]);

const REMOTE_SETTINGS_OMITTED_KEYS = new Set([
  ...REMOTE_SECRET_KEYS,
  ...REMOTE_PATH_KEYS,
  'args',
  'authToken',
  'command',
  'deviceSecret',
  'directory',
  'entryPath',
  'extraPaths',
  'fetchApiKeyEnv',
  'headers',
  'outputPath',
  'packPath',
  'remote',
  'root',
  'searchApiKeyEnv',
  'secretRef',
  'tokenRef',
]);

/**
 * Remote Settings is a read-only projection: enough product configuration to
 * render Desktop pages, without Host paths, secret refs, headers, or client
 * restore credentials.
 */
export function projectRemoteSettingsData(data: unknown): unknown {
  const record = asRecord(data);
  const snapshot = asRecord(record?.snapshot);
  if (snapshot === undefined) {
    return {};
  }
  return {
    snapshot: {
      schemaVersion: snapshot.schemaVersion,
      revision: typeof snapshot.revision === 'string' ? boundedString(snapshot.revision, 256) : '',
      runtimeRevision:
        typeof snapshot.runtimeRevision === 'string'
          ? boundedString(snapshot.runtimeRevision, 256)
          : '',
      domainRevisions: projectDomainRevisions(snapshot.domainRevisions),
      config: projectRemoteSettingsValue(snapshot.config, undefined),
    },
  };
}

function projectRemoteSettingsApplyData(data: unknown): unknown {
  const record = asRecord(data);
  if (record === undefined) {
    return {};
  }
  const projected = projectRemoteSettingsData({ snapshot: record.snapshot });
  const snapshot = asRecord(projected)?.snapshot;
  return {
    ...(snapshot === undefined ? {} : { snapshot }),
    changedDomains: Array.isArray(record.changedDomains) ? record.changedDomains.slice(0, 32) : [],
  };
}

function projectDomainRevisions(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (record === undefined) {
    return {};
  }
  const projected: Record<string, string> = {};
  for (const [domain, hash] of Object.entries(record)) {
    if (typeof hash === 'string' && hash.length > 0 && hash.length <= 256) {
      projected[domain] = hash;
    }
  }
  return projected;
}

function projectRemoteSettingsValue(value: unknown, key: string | undefined, depth = 0): unknown {
  if (depth > 12) {
    return undefined;
  }
  if (key === 'apiKeyRef' || key === 'apiKeyEnv') {
    return typeof value === 'string' && value.trim().length > 0
      ? REDACTED_STORED_SECRET
      : undefined;
  }
  if (key !== undefined && REMOTE_SETTINGS_OMITTED_KEYS.has(key)) {
    return undefined;
  }
  if (typeof value === 'string') {
    return boundedString(redactRemoteHostPaths(value), 32_000);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 128)
      .map((item) => projectRemoteSettingsValue(item, undefined, depth + 1))
      .filter((item) => item !== undefined);
  }
  const record = asRecord(value);
  if (record === undefined) {
    return value;
  }
  const projected: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(record)) {
    const child = projectRemoteSettingsValue(childValue, childKey, depth + 1);
    if (child !== undefined) {
      projected[childKey] = child;
    }
  }
  return projected;
}

function projectSessionUserMessageIndex(data: unknown): unknown {
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

function sanitizeRemoteValue(value: unknown, key: string | undefined): unknown {
  if (key !== undefined && REMOTE_SECRET_KEYS.has(key)) {
    return '[redacted]';
  }
  if (key !== undefined && REMOTE_PATH_KEYS.has(key)) {
    if (typeof value === 'string' && isRemoteAssetRef(value)) {
      return value;
    }
    return Array.isArray(value) ? [] : '[host-path]';
  }
  if (typeof value === 'string') {
    return boundedString(redactRemoteHostPaths(value), 256_000);
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

function projectRemoteQueuedTurnData(data: unknown, context: RemoteProjectionContext): unknown {
  const source = asRecord(data);
  const projected = asRecord(sanitizeRemoteValue(data, undefined));
  if (source === undefined || projected === undefined) {
    return projected ?? sanitizeRemoteValue(data, undefined);
  }
  if ('queuedTurn' in source) {
    projected.queuedTurn = projectRemoteQueuedTurnRecord(
      source.queuedTurn,
      context.remoteMediaPaths,
    );
  }
  if (Array.isArray(source.queuedTurns)) {
    projected.queuedTurns = source.queuedTurns.map((queuedTurn) =>
      projectRemoteQueuedTurnRecord(queuedTurn, context.remoteMediaPaths),
    );
  }
  return projected;
}

function projectRemoteQueuedTurnPush(
  message: Extract<HostPush, { type: 'session/queued-turn-updated' }>,
  remoteMediaPaths: ReadonlyMap<string, string> | undefined,
): HostPush {
  return {
    ...message,
    queuedTurn: projectRemoteQueuedTurnRecord(
      message.queuedTurn,
      remoteMediaPaths,
    ) as QueuedTurnRecord,
  };
}

function projectRemoteQueuedTurnRecord(
  value: unknown,
  remoteMediaPaths: ReadonlyMap<string, string> | undefined,
): unknown {
  const record = asRecord(value);
  if (record === undefined) {
    return sanitizeRemoteValue(value, undefined);
  }
  const input = asRecord(record.input);
  if (input === undefined || !Array.isArray(input.attachments)) {
    return sanitizeRemoteValue(record, undefined);
  }
  const attachments = input.attachments.map((attachment) => {
    const attachmentRecord = asRecord(attachment);
    if (attachmentRecord?.kind !== 'media' || typeof attachmentRecord.path !== 'string') {
      return attachment;
    }
    return {
      ...attachmentRecord,
      path: projectRemoteMediaRef(attachmentRecord.path, remoteMediaPaths),
    };
  });
  return sanitizeRemoteValue(
    {
      ...record,
      input: { ...input, attachments },
    },
    undefined,
  );
}

function projectRemoteMediaRef(
  value: string,
  remoteMediaPaths: ReadonlyMap<string, string> | undefined,
): string {
  if (isRemoteAssetRef(value)) {
    return value;
  }
  for (const [assetId, absolutePath] of remoteMediaPaths ?? []) {
    if (absolutePath === value && assetId.length > 0 && assetId.length <= 256) {
      return `remote-asset:${assetId}`;
    }
  }
  return '[host-path]';
}

function isRemoteAssetRef(value: string): boolean {
  if (!value.startsWith('remote-asset:')) return false;
  const assetId = value.slice('remote-asset:'.length);
  return assetId.length > 0 && assetId.length <= 256 && !/[\\/\u0000-\u001f]/.test(assetId);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Remote-safe projection for skills/read. Keeps the logical identity
 * (skillId / displayRef / typed status) and strips anything path-like;
 * legacy absolute paths never cross the wire for remote clients.
 */
function projectRemoteSkillsReadData(data: unknown): unknown {
  const record = asRecord(data);
  if (record === undefined) {
    return data;
  }
  if (record.status === 'ready') {
    const projected: Record<string, unknown> = {
      status: 'ready',
      skillId: boundedString(record.skillId, 256),
      name: boundedString(record.name, 512),
      displayRef: boundedString(record.displayRef, 512),
      content: boundedString(record.content, 512_000),
      byteSize:
        typeof record.byteSize === 'number' && Number.isSafeInteger(record.byteSize)
          ? record.byteSize
          : 0,
      truncated: record.truncated === true,
      provenance:
        record.provenance === 'current-resource' ? 'current-resource' : 'current-resource',
    };
    if (record.effectiveSource === 'bundled' || record.effectiveSource === 'user') {
      projected.effectiveSource = record.effectiveSource;
    }
    if (
      record.origin === 'bundled-installed' ||
      record.origin === 'user-installed' ||
      record.origin === 'project' ||
      record.origin === 'mapped' ||
      record.origin === 'unknown'
    ) {
      projected.origin = record.origin;
    }
    return projected;
  }
  if (record.status === 'unavailable') {
    const projected: Record<string, unknown> = {
      status: 'unavailable',
      reason: boundedString(record.reason, 128),
      displayRef: boundedString(record.displayRef, 512),
    };
    if (typeof record.skillId === 'string') {
      projected.skillId = boundedString(record.skillId, 256);
    }
    if (typeof record.suggestion === 'string') {
      projected.suggestion = boundedString(record.suggestion, 1024);
    }
    return projected;
  }
  return sanitizeRemoteValue(data, undefined);
}

/**
 * Remote-safe projection for session/tool-output: bounded snapshot text only.
 * The response shape already carries no Host paths; this keeps it explicit
 * and bounds every string that could embed one.
 */
function projectRemoteToolOutputData(data: unknown): unknown {
  const record = asRecord(data);
  if (record === undefined || record.status !== 'ready') {
    return sanitizeRemoteValue(data, undefined);
  }
  return {
    status: 'ready',
    output: boundedString(record.output, 512_000),
    truncated: record.truncated === true,
    redacted: record.redacted === true,
    provenance: 'tool-snapshot',
  };
}
