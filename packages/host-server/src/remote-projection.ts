import os from 'node:os';
import path from 'node:path';
import type {
  HostCommand,
  HostMode,
  HostPush,
  HostResponse,
  RemoteCapabilitySummary,
  RemoteHostStatusData,
  RemoteMediaSaveData,
  RemoteProjectSummary,
  QueuedTurnRecord,
} from '@piwin/contracts';
import {
  hostOsFamilyFromNodePlatform,
  hostPathStyleFromOsFamily,
  readActivitySummaryData,
  REDACTED_STORED_SECRET,
} from '@piwin/contracts';
import { createRemoteProjectId, isRemoteProjectId } from '@piwin/host-runtime';
import { projectConfiguredChatModelsResponse } from './remote-configured-models.js';
import { redactRemoteHostPaths } from './remote-redact.js';
import { projectRemoteLiveResponse } from './remote-live-projection.js';
import {
  asRecord,
  boundedString,
  isRemoteAssetRef,
  projectRemoteMediaRef,
  redactHostError,
} from './remote-projection-helpers.js';
import {
  projectHostSessionForRemoteClient,
  projectRemoteTranscriptAttachments,
  projectSessionList,
  projectSessionListPage,
  projectSessionMessages,
  projectSessionResume,
  projectSessionTranscriptPage,
  projectSessionUserMessageIndex,
} from './remote-session-projection.js';

export { redactRemoteHostPaths };

export type RemoteProjectionContext = {
  hostInstanceId: string;
  mode: HostMode;
  capabilities: RemoteCapabilitySummary;
  /** Host media id → absolute path, used to restore opaque client refs. */
  remoteMediaPaths?: ReadonlyMap<string, string>;
  /** Local loopback Desktop may keep one-shot Live start bootstrap. */
  liveOwner?: boolean;
  /**
   * This client declared the out-of-band binary browser-frame channel. When
   * false the frame carries an explicit unavailable payload instead of a
   * `[redacted]` pseudo-image (spec §4.1.2).
   */
  browserFrameBinary?: boolean;
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
  if (command.type === 'host/list-dir') {
    return response;
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
    browserFrameBinary: true,
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
    contextTelemetryVersion: 1,
    runInterventions: true,
    queuedTurns: true,
    foregroundRunAdmission: true,
    logicalProjectRefs: true,
    activityHydration: true,
    liveSubscriptions: true,
    flashcardStudy: true,
    knowledgeBases: true,
    hostListDir: true,
    homeDirectory: os.homedir(),
  };
}

export function projectRemotePush(
  message: HostPush,
  context?: Pick<
    RemoteProjectionContext,
    'remoteMediaPaths' | 'browserFrameBinary'
  >,
): HostPush {
  if (message.type === 'browser/frame') {
    // Live pixels never travel as a projected JSON string. Capable clients get
    // the metadata push on the control channel and the JPEG on the binary
    // channel; everyone else gets a truthful unavailable state.
    return {
      ...message,
      payload:
        context?.browserFrameBinary === true
          ? { kind: 'binary' }
          : { kind: 'unavailable', reason: 'client-update-required' },
    };
  }
  if (message.type === 'session/index-updated') {
    const projectedSession =
      message.session === undefined
        ? undefined
        : projectHostSessionForRemoteClient(message.session);
    return {
      type: 'session/index-updated',
      op: message.op,
      sessionId: message.sessionId,
      ...(projectedSession === undefined ? {} : { session: projectedSession }),
    } as HostPush;
  }
  if (message.type === 'session/queued-turn-updated') {
    return projectRemoteQueuedTurnPush(message, context?.remoteMediaPaths);
  }
  const projected = sanitizeRemoteValue(message, undefined);
  if (message.type === 'event') {
    return projectRemoteEventAttachments(projected, context?.remoteMediaPaths) as HostPush;
  }
  return (projected ?? message) as HostPush;
}

function projectRemoteEventAttachments(
  projected: unknown,
  remoteMediaPaths: ReadonlyMap<string, string> | undefined,
): unknown {
  const record = asRecord(projected);
  const event = asRecord(record?.event);
  if (event === undefined || event.type !== 'tool/end' || !Array.isArray(event.attachments)) {
    return projected;
  }
  return {
    ...record,
    event: {
      ...event,
      attachments: projectRemoteTranscriptAttachments(event.attachments, remoteMediaPaths),
    },
  };
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
  path?: string;
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
    ...(hostPath.length > 0 && !isRemoteProjectId(hostPath) ? { path: hostPath } : {}),
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
      path: record.path,
      trust,
    };
    if (typeof record.lastOpenedAt === 'string') {
      summary.lastOpenedAt = record.lastOpenedAt;
    }
    if (typeof record.gitRepositoryId === 'string' && record.gitRepositoryId.length > 0) {
      summary.gitRepositoryId = record.gitRepositoryId;
    }
    if (record.isPrimaryWorktree === true || record.isPrimaryWorktree === false) {
      summary.isPrimaryWorktree = record.isPrimaryWorktree;
    }
    if (typeof record.currentBranch === 'string' && record.currentBranch.length > 0) {
      summary.currentBranch = record.currentBranch;
    }
    if (typeof record.gitRootPath === 'string' && record.gitRootPath.length > 0) {
      summary.gitRootPath = record.gitRootPath;
    }
    projected.push(summary);
  }
  return projected;
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

/**
 * Settings fields the shell must be able to read and write back to Host.
 * Secrets stay redacted; pairing (`remote`) stays off this projection.
 */
const REMOTE_SETTINGS_SHELL_EDITABLE_KEYS = new Set([
  'args',
  'command',
  'directory',
  'entryPath',
  'extraPaths',
  'fetchApiKeyEnv',
  'searchApiKeyEnv',
]);

const REMOTE_SETTINGS_OMITTED_KEYS = new Set(
  [
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
  ].filter((key) => !REMOTE_SETTINGS_SHELL_EDITABLE_KEYS.has(key)),
);

/**
 * Remote Settings projection for Desktop/mobile shells. Secrets and pairing
 * credentials stay redacted. User-editable Host fields (CLI launchers, extra
 * skill paths, env var names) pass through so the shell can change them.
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
    if (key !== undefined && REMOTE_SETTINGS_SHELL_EDITABLE_KEYS.has(key)) {
      return boundedString(value, 32_000);
    }
    return boundedString(redactRemoteHostPaths(value), 32_000);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 128)
      .map((item) => projectRemoteSettingsValue(item, key, depth + 1))
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


function sanitizeRemoteValue(value: unknown, key: string | undefined): unknown {
  if (key !== undefined && REMOTE_SECRET_KEYS.has(key)) {
    return '[redacted]';
  }
  if (key !== undefined && REMOTE_PATH_KEYS.has(key)) {
    if (typeof value === 'string') {
      return isRemoteAssetRef(value) ? value : boundedString(value, 16_384);
    }
    if (Array.isArray(value)) {
      return value.slice(0, 100).map((item) => {
        if (typeof item === 'string') {
          return isRemoteAssetRef(item) ? item : boundedString(item, 16_384);
        }
        return sanitizeRemoteValue(item, undefined);
      });
    }
    return value;
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
