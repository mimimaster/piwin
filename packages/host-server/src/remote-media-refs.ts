import type { HostCommand, HostPush, HostResponse, MediaAttachmentRef } from '@piwin/contracts';

import { isRecord } from './remote-record-guard.js';

export const MAX_REMOTE_MEDIA_REFS = 256;
export const MAX_REMOTE_MEDIA_BASE64_CHARS = 950_000;

export function resolveRemoteCommand(
  command: HostCommand,
  remoteMediaPaths: Map<string, string>,
): HostCommand {
  if (
    command.type !== 'session/prompt' &&
    command.type !== 'session/queued-turn-submit' &&
    command.type !== 'session/queued-turn-edit' &&
    command.type !== 'session/replace-run' &&
    command.type !== 'run/intervention-submit' &&
    command.type !== 'run/intervention-edit'
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
