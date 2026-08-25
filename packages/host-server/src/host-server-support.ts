import { timingSafeEqual } from 'node:crypto';
import type {
  HostCommand,
  HostHydrationFrame,
  HostPush,
  HostResponse,
  MediaAttachmentRef,
  PromptAttachment,
  RemoteSessionSummary,
  RemoteTranscriptMessage,
} from '@piwin/contracts';
import {
  ACTIVITY_SUMMARY_MAX_ITEMS,
  isSupportedAttachmentMimeType,
  LIVE_SUBSCRIPTION_MAX_SESSION_IDS,
  QUEUED_TURN_MAX_TEXT_BYTES,
  SESSION_LIST_PAGE_MAX_ITEMS,
  SESSION_TRANSCRIPT_PAGE_MAX_BYTES,
  SESSION_TRANSCRIPT_PAGE_MAX_ITEMS,
  SESSION_TRANSCRIPT_PAGE_MIN_BYTES,
  SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS,
  SESSION_USER_MESSAGE_INDEX_MAX_TICKS,
  SESSION_USER_MESSAGE_INDEX_MIN_TICKS,
} from '@piwin/contracts';
import { isRemoteProjectId } from '@piwin/host-runtime';
import { decodeHostWireMessage, encodeHostWireMessage } from '@piwin/host-transport';
import { projectRemoteResponse } from './remote-projection.js';
import { areSafeRemoteContextRefs } from './remote-context-ref.js';
import { isSafeRemoteSettingsApply } from './remote-settings-apply.js';
import { isSafeRemotePermissionRulesCommand } from './remote-permission-rules.js';

export const MAX_REMOTE_MEDIA_REFS = 256;
export const MAX_REMOTE_MEDIA_BASE64_CHARS = 950_000;
export const MAX_HYDRATION_SESSIONS = 200;
export const MAX_HYDRATION_SUBSCRIPTIONS = LIVE_SUBSCRIPTION_MAX_SESSION_IDS;
export const MAX_HYDRATION_MESSAGES_PER_SESSION = 16;
export const MAX_HYDRATION_TEXT_BYTES = 16 * 1024;
export const MAX_HYDRATION_THINKING_BYTES = 8 * 1024;
export const MAX_HYDRATION_FRAME_BYTES = 900 * 1024;

export function normalizeSeq(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]';
}

export function isLoopbackBrowserOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (url.protocol === 'tauri:') {
      return host === 'localhost' || host === '127.0.0.1';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host === 'tauri.localhost'
    );
  } catch {
    return false;
  }
}

export function authTokensEqual(expected: string, provided: string | undefined): boolean {
  if (provided === undefined) {
    return false;
  }
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(provided, 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function formatWebSocketUrl(host: string, port: number): string {
  // Wildcard binds are not dialable; advertise loopback so local shells can connect.
  const dialHost = isWildcardHost(host) ? '127.0.0.1' : host;
  const displayHost =
    dialHost.includes(':') && !dialHost.startsWith('[') ? `[${dialHost}]` : dialHost;
  return `ws://${displayHost}:${port}`;
}

export function isSafeRemoteProjectLocator(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && isRemoteProjectId(value));
}

export function isSafeRemoteSessionListPageScope(scope: unknown): boolean {
  if (!isRecord(scope) || typeof scope.kind !== 'string') {
    return false;
  }
  if (scope.kind === 'general') {
    return true;
  }
  return (
    scope.kind === 'project' &&
    typeof scope.projectPath === 'string' &&
    isRemoteProjectId(scope.projectPath)
  );
}

export function isSafeRemoteSessionListScopeRef(scopeRef: unknown): boolean {
  if (scopeRef === undefined) {
    return true;
  }
  if (!isRecord(scopeRef) || typeof scopeRef.kind !== 'string') {
    return false;
  }
  if (scopeRef.kind === 'general' || scopeRef.kind === 'all-authorized') {
    return true;
  }
  return (
    scopeRef.kind === 'project' &&
    typeof scopeRef.projectId === 'string' &&
    isRemoteProjectId(scopeRef.projectId)
  );
}

export function isSafeRemoteCommand(command: HostCommand): boolean {
  // Phone-access listen/pairing is local sidecar IPC, not a Host command.
  if (command.type.startsWith('mobile-access/')) {
    return false;
  }
  switch (command.type) {
    case 'activity/summary':
      return (
        command.maxItems === undefined ||
        (typeof command.maxItems === 'number' &&
          Number.isSafeInteger(command.maxItems) &&
          command.maxItems > 0 &&
          command.maxItems <= ACTIVITY_SUMMARY_MAX_ITEMS)
      );
    case 'session/list':
      return (
        isSafeRemoteProjectLocator(command.projectPath) &&
        (command.scope === undefined ||
          command.scope.kind === 'general' ||
          (command.scope.kind === 'project' && isRemoteProjectId(command.scope.projectPath))) &&
        isSafeRemoteSessionListScopeRef(command.scopeRef) &&
        (command.allScopes === undefined ||
          command.allScopes === true ||
          command.allScopes === false) &&
        (command.order === undefined ||
          command.order === 'updated' ||
          command.order === 'alphabetical') &&
        (command.maxItems === undefined ||
          (typeof command.maxItems === 'number' &&
            Number.isSafeInteger(command.maxItems) &&
            command.maxItems > 0))
      );
    case 'session/list-page': {
      const query: unknown = command.query;
      if (!isRecord(query) || !isRecord(query.scope)) {
        return false;
      }
      return (
        isSafeRemoteSessionListPageScope(query.scope) &&
        (query.lifecycle === 'active' || query.lifecycle === 'archived') &&
        (query.order === 'updated' || query.order === 'alphabetical') &&
        typeof query.limit === 'number' &&
        Number.isSafeInteger(query.limit) &&
        query.limit > 0 &&
        query.limit <= SESSION_LIST_PAGE_MAX_ITEMS &&
        (query.anchorSessionId === undefined ||
          (typeof query.anchorSessionId === 'string' &&
            query.anchorSessionId.length > 0 &&
            query.anchorSessionId.length <= 256)) &&
        (query.cursor === undefined ||
          (typeof query.cursor === 'string' && query.cursor.length <= 512))
      );
    }
    case 'session/foreground-run':
    case 'session/lineage':
    case 'session/runtime-status':
      return isSafeRemoteId(command.sessionId);
    case 'session/reload-runtime':
      return (
        isSafeRemoteId(command.sessionId) &&
        command.expectedSettingsRevision.length > 0 &&
        command.expectedSettingsRevision.length <= 256 &&
        (command.when === 'now' || command.when === 'after-current-run')
      );
    case 'session/list-children':
      return isSafeRemoteId(command.parentSessionId);
    case 'session/duplicate':
      return (
        isSafeRemoteId(command.sessionId) &&
        (command.name === undefined || command.name.length <= 512) &&
        (command.targetScope === undefined || command.targetScope.kind === 'general') &&
        command.messageProjection === 'none'
      );
    case 'session/fork':
      return (
        isSafeRemoteId(command.sessionId) &&
        isSafeRemoteId(command.messageId) &&
        (command.name === undefined || command.name.length <= 512) &&
        command.workspaceStrategy === 'shared' &&
        command.messageProjection === 'none'
      );
    case 'session/truncate-from':
      return (
        isSafeRemoteId(command.sessionId) &&
        isSafeRemoteId(command.messageId) &&
        (command.messageProjection === 'tail' || command.messageProjection === 'none')
      );
    case 'session/branch-list':
      return isSafeRemoteId(command.sessionId);
    case 'session/branch-switch':
      return (
        isSafeRemoteId(command.sessionId) &&
        isSafeRemoteId(command.targetMessageId) &&
        (command.confirm === undefined || typeof command.confirm === 'boolean') &&
        (command.messageProjection === undefined ||
          command.messageProjection === 'tail' ||
          command.messageProjection === 'none')
      );
    case 'session/compact':
      return (
        isSafeRemoteId(command.sessionId) &&
        (command.customInstructions === undefined ||
          Buffer.byteLength(command.customInstructions, 'utf8') <= 64 * 1024) &&
        (command.targetModel === undefined ||
          (isSafeRemoteId(command.targetModel.providerId) &&
            isSafeRemoteId(command.targetModel.modelId)))
      );
    case 'session/compact-abort':
      return isSafeRemoteId(command.sessionId);
    case 'session/transcript-page': {
      const query: unknown = command.query;
      if (!isRecord(query)) return false;
      return (
        typeof query.sessionId === 'string' &&
        query.sessionId.length > 0 &&
        query.sessionId.length <= 256 &&
        typeof query.limit === 'number' &&
        Number.isSafeInteger(query.limit) &&
        query.limit > 0 &&
        query.limit <= SESSION_TRANSCRIPT_PAGE_MAX_ITEMS &&
        typeof query.maximumBytes === 'number' &&
        Number.isSafeInteger(query.maximumBytes) &&
        query.maximumBytes >= SESSION_TRANSCRIPT_PAGE_MIN_BYTES &&
        query.maximumBytes <= SESSION_TRANSCRIPT_PAGE_MAX_BYTES &&
        (query.beforeCursor === undefined ||
          (typeof query.beforeCursor === 'string' && query.beforeCursor.length <= 512))
      );
    }
    case 'session/user-message-index': {
      const query: unknown = command.query;
      if (!isRecord(query)) return false;
      return (
        typeof query.sessionId === 'string' &&
        query.sessionId.length > 0 &&
        query.sessionId.length <= 256 &&
        typeof query.maximumTicks === 'number' &&
        Number.isSafeInteger(query.maximumTicks) &&
        query.maximumTicks >= SESSION_USER_MESSAGE_INDEX_MIN_TICKS &&
        query.maximumTicks <= SESSION_USER_MESSAGE_INDEX_MAX_TICKS
      );
    }
    case 'session/transcript-window': {
      const query: unknown = command.query;
      if (!isRecord(query)) return false;
      return (
        typeof query.sessionId === 'string' &&
        query.sessionId.length > 0 &&
        query.sessionId.length <= 256 &&
        typeof query.anchorMessageId === 'string' &&
        query.anchorMessageId.length > 0 &&
        query.anchorMessageId.length <= 256 &&
        typeof query.beforeItems === 'number' &&
        Number.isSafeInteger(query.beforeItems) &&
        query.beforeItems >= 0 &&
        typeof query.afterItems === 'number' &&
        Number.isSafeInteger(query.afterItems) &&
        query.afterItems >= 0 &&
        query.beforeItems + query.afterItems + 1 <= SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS &&
        typeof query.maximumBytes === 'number' &&
        Number.isSafeInteger(query.maximumBytes) &&
        query.maximumBytes >= SESSION_TRANSCRIPT_PAGE_MIN_BYTES &&
        query.maximumBytes <= SESSION_TRANSCRIPT_PAGE_MAX_BYTES
      );
    }
    case 'session/create':
      return (
        command.input.projectPath === undefined &&
        command.input.cwd === undefined &&
        command.input.parentSessionId === undefined &&
        command.input.subagent === undefined &&
        (command.input.scope === undefined || command.input.scope.kind === 'general') &&
        (command.input.projectId === undefined || isRemoteProjectId(command.input.projectId))
      );
    case 'session/prompt':
      return (
        (command.input.attachments === undefined ||
          (command.input.attachments.length <= 8 &&
            command.input.attachments.every(isSafeRemoteAttachment))) &&
        areSafeRemoteContextRefs(command.input.contextRefs) &&
        command.input.text.length <= 512_000 &&
        (command.input.branchFromMessageId === undefined ||
          isSafeRemoteId(command.input.branchFromMessageId))
      );
    case 'settings/apply':
      return isSafeRemoteSettingsApply(command);
    case 'permissions/get-rules':
    case 'permissions/set-rules':
      return isSafeRemotePermissionRulesCommand(command);
    case 'todo/get':
      return isSafeRemoteId(command.sessionId);
    case 'todo/set':
      return (
        isSafeRemoteId(command.sessionId) &&
        command.items.length <= 64 &&
        (command.expectedRevision === undefined ||
          (command.expectedRevision.length > 0 && command.expectedRevision.length <= 256))
      );
    case 'notes/write':
      return command.input.title.length <= 512 && command.input.content.length <= 256 * 1024;
    case 'notes/update':
      return (
        isSafeRemoteId(command.input.id) &&
        (command.input.expectedContentHash === undefined ||
          (command.input.expectedContentHash.length > 0 &&
            command.input.expectedContentHash.length <= 256))
      );
    case 'notes/delete':
      return (
        isSafeRemoteId(command.noteId) &&
        (command.expectedContentHash === undefined ||
          (command.expectedContentHash.length > 0 && command.expectedContentHash.length <= 256))
      );
    case 'session/queued-turn-submit':
      return isSafeQueuedTurnCommand(
        command.sessionId,
        command.queuedTurnId,
        command.userMessageId,
        command.input,
      );
    case 'session/queued-turn-edit':
      return (
        isSafeQueuedTurnCommand(
          command.sessionId,
          command.queuedTurnId,
          undefined,
          command.input,
        ) &&
        Number.isSafeInteger(command.expectedRevision) &&
        command.expectedRevision > 0
      );
    case 'session/queued-turn-list':
      return isSafeRemoteId(command.sessionId);
    case 'session/queued-turn-cancel':
      return (
        isSafeRemoteId(command.sessionId) &&
        isSafeRemoteId(command.queuedTurnId) &&
        Number.isSafeInteger(command.expectedRevision) &&
        command.expectedRevision > 0
      );
    case 'session/queued-turn-reorder':
      return (
        isSafeRemoteId(command.sessionId) &&
        Number.isSafeInteger(command.expectedQueueRevision) &&
        command.expectedQueueRevision >= 0 &&
        command.orderedQueuedTurnIds.length <= 20 &&
        command.orderedQueuedTurnIds.every(isSafeRemoteId)
      );
    case 'session/replace-run':
      return (
        isSafeQueuedTurnCommand(
          command.sessionId,
          command.queuedTurnId,
          command.userMessageId,
          command.input,
        ) && isSafeRemoteId(command.runId)
      );
    case 'session/steer':
      return (
        command.message.length <= 512_000 &&
        (command.clientMessageId === undefined || command.clientMessageId.length <= 256)
      );
    case 'session/cold-storage-status':
    case 'session/cold-storage-reconcile':
      return true;
    case 'session/cold-storage-plan':
      return (
        command.sessionIds === undefined ||
        (command.sessionIds.length <= 128 && command.sessionIds.every(isSafeRemoteId))
      );
    case 'session/cold-storage-execute':
      return (
        isSafeRemoteId(command.planId) &&
        command.confirmationDigest.length > 0 &&
        command.confirmationDigest.length <= 512
      );
    case 'session/cold-storage-restore':
      return isSafeRemoteId(command.sessionId) && command.packPath === undefined;
    case 'plan/get':
      return isSafeRemoteId(command.sessionId);
    case 'plan/execute':
      return (
        isSafeRemoteId(command.request.sessionId) &&
        isSafeRemoteId(command.request.planId) &&
        (command.request.mode === 'inline' || command.request.mode === 'subagent-driven') &&
        (command.request.expectedRevision === undefined ||
          (Number.isSafeInteger(command.request.expectedRevision) &&
            command.request.expectedRevision >= 0))
      );
    case 'plan/abort':
      return isSafeRemoteId(command.sessionId) && isSafeRemoteId(command.planId);
    case 'walkthrough/list':
      return (
        isSafeRemoteId(command.sessionId) &&
        (command.knownMessageIds === undefined ||
          (command.knownMessageIds.length <= 256 && command.knownMessageIds.every(isSafeRemoteId)))
      );
    case 'walkthrough/generate':
      return (
        isSafeRemoteId(command.sessionId) &&
        isSafeRemoteId(command.messageId) &&
        (command.runId === undefined || isSafeRemoteId(command.runId))
      );
    case 'walkthrough/cancel':
      return (
        isSafeRemoteId(command.sessionId) &&
        isSafeRemoteId(command.messageId) &&
        (command.generationId === undefined || isSafeRemoteId(command.generationId))
      );
    case 'extension/ui_resolve':
      return (
        isSafeRemoteId(command.requestId) &&
        (command.value === undefined || Buffer.byteLength(command.value, 'utf8') <= 64 * 1024)
      );
    case 'session/follow_up':
      return (
        command.message.length <= 512_000 &&
        (command.clientMessageId === undefined || command.clientMessageId.length <= 256)
      );
    case 'run/intervention-submit':
      return (
        command.sessionId.length > 0 &&
        command.sessionId.length <= 256 &&
        command.runId.length > 0 &&
        command.runId.length <= 256 &&
        command.interventionId.length > 0 &&
        command.interventionId.length <= 256 &&
        command.userMessageId.length > 0 &&
        command.userMessageId.length <= 256 &&
        command.input.text.length <= 64 * 1024 &&
        (command.input.attachments === undefined || command.input.attachments.length === 0) &&
        (command.input.contextRefs === undefined || command.input.contextRefs.length === 0) &&
        (command.adoptQueuedTurn === undefined ||
          (command.adoptQueuedTurn.queuedTurnId.length > 0 &&
            command.adoptQueuedTurn.queuedTurnId.length <= 256 &&
            Number.isSafeInteger(command.adoptQueuedTurn.expectedRevision) &&
            command.adoptQueuedTurn.expectedRevision > 0))
      );
    case 'run/intervention-edit':
      return (
        command.sessionId.length > 0 &&
        command.sessionId.length <= 256 &&
        command.runId.length > 0 &&
        command.runId.length <= 256 &&
        command.interventionId.length > 0 &&
        command.interventionId.length <= 256 &&
        Number.isSafeInteger(command.expectedRevision) &&
        command.expectedRevision > 0 &&
        command.input.text.length <= 64 * 1024 &&
        (command.input.attachments === undefined || command.input.attachments.length === 0) &&
        (command.input.contextRefs === undefined || command.input.contextRefs.length === 0)
      );
    case 'run/intervention-cancel':
      return (
        command.sessionId.length > 0 &&
        command.sessionId.length <= 256 &&
        command.runId.length > 0 &&
        command.runId.length <= 256 &&
        command.interventionId.length > 0 &&
        command.interventionId.length <= 256 &&
        Number.isSafeInteger(command.expectedRevision) &&
        command.expectedRevision > 0
      );
    case 'preview/read-local-file':
      // ADR 0052 Slice 4: host-absolute path preview is local-sidecar only.
      // Remote clients must not send this command even as the operator.
      return false;
    case 'preview/export-local-file':
      // Save As byte export is local-sidecar only (same boundary as Slice 4).
      return false;
    case 'media/save':
      return (
        (command.input.source === 'file-picker' ||
          command.input.source === 'drop' ||
          command.input.source === 'paste') &&
        isSupportedAttachmentMimeType(command.input.mimeType) &&
        command.input.base64Data.length > 0 &&
        command.input.base64Data.length <= MAX_REMOTE_MEDIA_BASE64_CHARS
      );
    case 'media/save-begin':
      return (
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(command.input.sessionId) &&
        (command.input.source === 'file-picker' ||
          command.input.source === 'drop' ||
          command.input.source === 'paste') &&
        isSupportedAttachmentMimeType(command.input.mimeType) &&
        Number.isSafeInteger(command.input.byteSize) &&
        command.input.byteSize > 0 &&
        command.input.byteSize <= 10 * 1024 * 1024
      );
    case 'media/save-chunk':
      return (
        /^[A-Za-z0-9-]{8,128}$/.test(command.input.uploadId) &&
        Number.isSafeInteger(command.input.chunkIndex) &&
        command.input.chunkIndex >= 0 &&
        command.input.base64Data.length > 0 &&
        command.input.base64Data.length <= MAX_REMOTE_MEDIA_BASE64_CHARS
      );
    case 'media/save-finish':
    case 'media/save-abort':
      return /^[A-Za-z0-9-]{8,128}$/.test(command.input.uploadId);
    case 'media/read':
      // Logical-id addressing only; charset matches the media vault's safe
      // segment domain so traversal-shaped ids never reach the runtime.
      return (
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(command.input.sessionId) &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(command.input.assetId) &&
        (command.input.maxBytes === undefined ||
          (Number.isSafeInteger(command.input.maxBytes) &&
            command.input.maxBytes >= 1024 &&
            command.input.maxBytes <= 8 * 1024 * 1024))
      );
    case 'host/runtime-resources':
      return true;
    case 'notes/list':
      return (
        (command.collection === undefined || command.collection.length <= 256) &&
        (command.tags === undefined ||
          (command.tags.length <= 32 && command.tags.every((tag) => tag.length <= 128)))
      );
    case 'notes/read':
      return isSafeRemoteId(command.noteId);
    case 'notes/search':
      return (
        Buffer.byteLength(command.query.query, 'utf8') <= 16 * 1024 &&
        (command.query.collection === undefined || command.query.collection.length <= 256) &&
        (command.query.tags === undefined ||
          (command.query.tags.length <= 32 &&
            command.query.tags.every((tag) => tag.length <= 128))) &&
        (command.query.limit === undefined ||
          (Number.isSafeInteger(command.query.limit) &&
            command.query.limit > 0 &&
            command.query.limit <= 100)) &&
        (command.query.mode === undefined ||
          command.query.mode === 'auto' ||
          command.query.mode === 'fts' ||
          command.query.mode === 'vector' ||
          command.query.mode === 'hybrid')
      );
    case 'flashcards/list':
      return (
        command.sourceFolder === undefined &&
        (command.deck === undefined || command.deck.length <= 256) &&
        (command.sourceNoteId === undefined || isSafeRemoteId(command.sourceNoteId)) &&
        (command.sequenceId === undefined || isSafeRemoteId(command.sequenceId))
      );
    case 'flashcards/decks':
      return true;
    case 'flashcards/queue':
      return command.deck === undefined || command.deck.length <= 256;
    case 'flashcards/rate':
      return (
        isSafeRemoteId(command.cardId) &&
        (command.rating === 'again' ||
          command.rating === 'hard' ||
          command.rating === 'good' ||
          command.rating === 'easy')
      );
    case 'usage/get-rollup':
      return (
        command.projectPath === undefined &&
        (command.topSessions === undefined ||
          (Number.isSafeInteger(command.topSessions) &&
            command.topSessions > 0 &&
            command.topSessions <= 100)) &&
        (command.window === undefined ||
          ((command.window.from === undefined || command.window.from.length <= 128) &&
            (command.window.to === undefined || command.window.to.length <= 128)))
      );
    case 'skills/list':
    case 'prompts/list':
      return command.projectPath === undefined;
    case 'preview/read-trusted-text':
      // Config-root-relative only. Reject absolute paths, traversal, and
      // media-vault prefixes before the command reaches the runtime.
      return (
        isSafeTrustedTextRelativePath(command.input.relativePath) &&
        (command.input.maxBytes === undefined ||
          (Number.isSafeInteger(command.input.maxBytes) &&
            command.input.maxBytes >= 1024 &&
            command.input.maxBytes <= 512 * 1024))
      );
    case 'skills/read':
      // Remote clients may only use the logical skillId; legacyPath and
      // projectPath are Host-local compatibility hints and stay disabled.
      return (
        typeof command.skillId === 'string' &&
        command.skillId.trim().length > 0 &&
        command.skillId.length <= 256 &&
        command.legacyPath === undefined &&
        command.projectPath === undefined &&
        (command.maxBytes === undefined ||
          (Number.isSafeInteger(command.maxBytes) &&
            command.maxBytes >= 1024 &&
            command.maxBytes <= 512 * 1024))
      );
    case 'extensions/list':
      return command.projectPath === undefined;
    case 'extensions/set_enabled':
      return command.extensionId.trim().length > 0 && command.extensionId.length <= 256;
    case 'extensions/apply':
      return (
        command.sessionId.trim().length > 0 &&
        command.sessionId.length <= 256 &&
        (command.expectedSettingsRevision === undefined ||
          command.expectedSettingsRevision.length <= 256) &&
        (command.expectedRegistryRevision === undefined ||
          command.expectedRegistryRevision.length <= 256) &&
        (command.targetExtensionSetRevision === undefined ||
          command.targetExtensionSetRevision.length <= 256) &&
        (command.deploymentId === undefined || command.deploymentId.length <= 256)
      );
    case 'session/tool-output':
      return (
        typeof command.sessionId === 'string' &&
        command.sessionId.length > 0 &&
        command.sessionId.length <= 256 &&
        typeof command.messageId === 'string' &&
        command.messageId.length > 0 &&
        command.messageId.length <= 256 &&
        typeof command.toolCallId === 'string' &&
        command.toolCallId.length > 0 &&
        command.toolCallId.length <= 256 &&
        (command.maxBytes === undefined ||
          (Number.isSafeInteger(command.maxBytes) &&
            command.maxBytes >= 1024 &&
            command.maxBytes <= 512 * 1024))
      );
    default:
      return true;
  }
}

export function resolveRemoteCommand(
  command: HostCommand,
  remoteMediaPaths: Map<string, string>,
): HostCommand {
  if (
    command.type !== 'session/prompt' &&
    command.type !== 'session/queued-turn-submit' &&
    command.type !== 'session/queued-turn-edit' &&
    command.type !== 'session/replace-run'
  ) {
    return command;
  }
  if (command.input.attachments === undefined) return command;
  const attachments = command.input.attachments.map((attachment) => {
    if (attachment.kind !== 'media' || !attachment.path.startsWith('remote-asset:')) {
      return attachment;
    }
    const assetId = attachment.path.slice('remote-asset:'.length);
    const absolutePath = remoteMediaPaths.get(assetId);
    if (absolutePath === undefined) {
      throw new Error('Remote media asset is not available on this Host');
    }
    return { ...attachment, path: absolutePath } satisfies MediaAttachmentRef;
  });
  return { ...command, input: { ...command.input, attachments } };
}

export function isSafeQueuedTurnCommand(
  sessionId: string,
  queuedTurnId: string,
  userMessageId: string | undefined,
  input: import('@piwin/contracts').PromptInput,
): boolean {
  return (
    isSafeRemoteId(sessionId) &&
    isSafeRemoteId(queuedTurnId) &&
    (userMessageId === undefined || isSafeRemoteId(userMessageId)) &&
    Buffer.byteLength(input.text, 'utf8') <= QUEUED_TURN_MAX_TEXT_BYTES &&
    (input.attachments === undefined ||
      (input.attachments.length <= 8 && input.attachments.every(isSafeRemoteAttachment))) &&
    areSafeRemoteContextRefs(input.contextRefs) &&
    input.source === undefined &&
    input.resumeCheckpointId === undefined
  );
}

/** Walk a push payload for `{ kind: 'media', id, path }` attachment refs. */
export function collectMediaRefs(
  value: unknown,
  visit: (id: string, path: string) => void,
  depth = 0,
): void {
  if (depth > 12 || value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMediaRefs(item, visit, depth + 1);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    record.kind === 'media' &&
    typeof record.id === 'string' &&
    typeof record.path === 'string' &&
    record.id.length > 0 &&
    record.id.length <= 256 &&
    record.path.length > 0
  ) {
    visit(record.id, record.path);
  }
  for (const child of Object.values(record)) {
    if (child !== null && typeof child === 'object') {
      collectMediaRefs(child, visit, depth + 1);
    }
  }
}

function pruneRemoteMediaPaths(store: Map<string, string>): void {
  while (store.size > MAX_REMOTE_MEDIA_REFS) {
    const oldestId = store.keys().next().value;
    if (typeof oldestId !== 'string') {
      break;
    }
    store.delete(oldestId);
  }
}

/** Host-generated assets reach remote clients through pushes (ADR 0052). */
export function rememberRemoteMediaRefsFromPush(
  store: Map<string, string>,
  message: HostPush,
): void {
  collectMediaRefs(message, (id, path) => {
    store.set(id, path);
  });
  pruneRemoteMediaPaths(store);
}

export function rememberRemoteMediaAsset(
  store: Map<string, string>,
  command: HostCommand,
  response: HostResponse,
): void {
  if (
    (command.type !== 'media/save' && command.type !== 'media/save-finish') ||
    !response.success ||
    !isRecord(response.data)
  ) {
    return;
  }
  const asset = isRecord(response.data.asset) ? response.data.asset : undefined;
  if (
    asset === undefined ||
    typeof asset.id !== 'string' ||
    typeof asset.absolutePath !== 'string' ||
    asset.id.length === 0 ||
    asset.absolutePath.length === 0
  ) {
    return;
  }
  store.set(asset.id, asset.absolutePath);
  pruneRemoteMediaPaths(store);
}

export function isSafeRemoteId(value: string): boolean {
  return value.length > 0 && value.length <= 256;
}

/**
 * Remote preview paths must be config-root-relative, posix, and never the
 * media vault. Absolute / traversal shapes stay at the guard so they never
 * become a Host filesystem probe.
 */
export function isSafeTrustedTextRelativePath(relativePath: string): boolean {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.length > 512) {
    return false;
  }
  if (relativePath.includes('\\') || relativePath.includes('..')) {
    return false;
  }
  if (relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)) {
    return false;
  }
  if (relativePath === 'media' || relativePath.startsWith('media/')) {
    return false;
  }
  return /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(relativePath);
}

export function isSafeRemoteAttachment(attachment: PromptAttachment): boolean {
  return (
    attachment.kind === 'media' &&
    typeof attachment.path === 'string' &&
    attachment.path.startsWith('remote-asset:') &&
    attachment.path.length > 'remote-asset:'.length
  );
}

export function requestIdFromSerializedWire(serialized: string): string | undefined {
  try {
    const preview = decodeHostWireMessage(serialized);
    if (preview.type === 'command' && typeof preview.requestId === 'string') {
      return preview.requestId;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeHydrationSessionIds(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const sessionId of value) {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0 || seen.has(sessionId)) {
      continue;
    }
    seen.add(sessionId);
    result.push(sessionId);
    if (result.length >= MAX_HYDRATION_SUBSCRIPTIONS) break;
  }
  return result;
}

export function isRemoteSessionSummary(value: unknown): value is RemoteSessionSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.sessionId === 'string' &&
    (value.scope === 'general' || value.scope === 'project' || value.scope === 'unknown')
  );
}

export function limitHydrationMessage(message: RemoteTranscriptMessage): RemoteTranscriptMessage {
  const limited: RemoteTranscriptMessage = {
    ...message,
    text: truncateUtf8(message.text, MAX_HYDRATION_TEXT_BYTES),
  };
  if (message.thinking !== undefined) {
    limited.thinking = truncateUtf8(message.thinking, MAX_HYDRATION_THINKING_BYTES);
  }
  if (message.tools !== undefined && message.tools.length > 0) {
    limited.tools = message.tools.slice(0, 8).map((tool) => ({
      ...tool,
      output: truncateUtf8(tool.output, 2 * 1024),
    }));
  }
  return limited;
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (new TextEncoder().encode(value).byteLength <= maxBytes) return value;
  let candidate = value.slice(0, maxBytes);
  while (candidate.length > 0 && new TextEncoder().encode(`${candidate}…`).byteLength > maxBytes) {
    candidate = candidate.slice(0, -1);
  }
  return `${candidate}…`;
}

export function fitHydrationFrame(frame: HostHydrationFrame): HostHydrationFrame {
  let candidate = frame;
  while (true) {
    try {
      const encoded = encodeHostWireMessage(candidate);
      if (new TextEncoder().encode(encoded).byteLength <= MAX_HYDRATION_FRAME_BYTES) {
        return candidate;
      }
    } catch {
      // Trim below and retry. The resulting frame remains explicit and bounded.
    }

    const messageSessionIds = Object.keys(candidate.snapshot.messagesBySession);
    const removableSessionId = messageSessionIds.at(-1);
    if (removableSessionId !== undefined) {
      const messagesBySession = { ...candidate.snapshot.messagesBySession };
      delete messagesBySession[removableSessionId];
      candidate = {
        ...candidate,
        snapshot: {
          ...candidate.snapshot,
          messagesBySession,
          truncatedSessionIds: [
            ...new Set([...candidate.snapshot.truncatedSessionIds, removableSessionId]),
          ],
        },
      };
      continue;
    }

    if (candidate.snapshot.sessions.length > 0) {
      candidate = {
        ...candidate,
        snapshot: {
          ...candidate.snapshot,
          sessions: candidate.snapshot.sessions.slice(0, -1),
        },
      };
      continue;
    }

    return {
      ...candidate,
      snapshot: { ...candidate.snapshot, messagesBySession: {}, sessions: [] },
    };
  }
}
