/**
 * Rebind generated vault assets that never landed on a transcript row.
 * Image/video tools write `~/.piwin/media/<session>/` even when the matching
 * tool/end misses the assistant message; resume must still show the media.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { MediaAttachmentRef, SessionTranscriptMessage } from '@piwin/contracts';
import type { SessionTranscriptStore } from '@piwin/session';

export type OrphanGeneratedMedia = {
  assetId: string;
  createdAt: string;
  mimeType: string;
  byteSize: number;
  absolutePath: string;
  kind: 'image' | 'video';
};

export function attachOrphansToTranscriptMessages(
  messages: readonly SessionTranscriptMessage[],
  orphans: readonly OrphanGeneratedMedia[],
): SessionTranscriptMessage[] {
  if (orphans.length === 0 || messages.length === 0) {
    return [...messages];
  }
  const referenced = collectReferencedMediaIds(messages);
  const next = messages.map((message) => ({
    ...message,
    ...(message.attachments ? { attachments: [...message.attachments] } : {}),
  }));
  let changed = false;

  for (const orphan of orphans) {
    if (referenced.has(orphan.assetId)) {
      continue;
    }
    const targetIndex = findTurnAssistantIndex(next, orphan.createdAt);
    const target = targetIndex === -1 ? undefined : next[targetIndex];
    if (target === undefined || targetIndex === -1) {
      continue;
    }
    const attachment = toGeneratedAttachment(orphan);
    const attachments = [...(target.attachments ?? []), attachment];
    next[targetIndex] = { ...target, attachments };
    referenced.add(orphan.assetId);
    changed = true;
  }

  return changed ? next : [...messages];
}

function collectReferencedMediaIds(messages: readonly SessionTranscriptMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      ids.add(attachment.id);
      const fileName = attachment.path.split(/[/\\]/).pop();
      if (fileName) {
        ids.add(fileName.replace(/\.[^.]+$/, ''));
      }
    }
  }
  return ids;
}

function findTurnAssistantIndex(
  messages: readonly SessionTranscriptMessage[],
  orphanCreatedAt: string,
): number {
  const orphanMs = Date.parse(orphanCreatedAt);
  if (Number.isNaN(orphanMs)) {
    return findLastAssistantIndex(messages);
  }
  let lastUserIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== 'user') {
      continue;
    }
    const createdMs = Date.parse(message.createdAt);
    if (!Number.isNaN(createdMs) && createdMs <= orphanMs) {
      lastUserIndex = index;
    }
  }
  const start = lastUserIndex === -1 ? 0 : lastUserIndex + 1;
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      break;
    }
    if (message?.role === 'assistant') {
      return index;
    }
  }
  return findLastAssistantIndex(messages);
}

function findLastAssistantIndex(messages: readonly SessionTranscriptMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      return index;
    }
  }
  return -1;
}

function toGeneratedAttachment(orphan: OrphanGeneratedMedia): MediaAttachmentRef {
  const attachment: MediaAttachmentRef = {
    id: orphan.assetId,
    kind: 'media',
    path: orphan.absolutePath,
    mimeType: orphan.mimeType,
    byteSize: orphan.byteSize,
    source: 'generated',
  };
  if (orphan.kind === 'image') {
    attachment.contentKind = 'image';
  }
  return attachment;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

export async function listSessionGeneratedMedia(
  sessionMediaDir: string,
): Promise<OrphanGeneratedMedia[]> {
  const files = await readdir(sessionMediaDir).catch(() => []);
  const items: OrphanGeneratedMedia[] = [];
  for (const fileName of files) {
    if (fileName.includes('.thumb.')) {
      continue;
    }
    const ext = extname(fileName).toLowerCase();
    const isImage = IMAGE_EXT.has(ext);
    const isVideo = VIDEO_EXT.has(ext);
    if (!isImage && !isVideo) {
      continue;
    }
    const absolutePath = join(sessionMediaDir, fileName);
    const fileStat = await stat(absolutePath).catch(() => null);
    if (fileStat === null || !fileStat.isFile()) {
      continue;
    }
    const assetId = fileName.slice(0, fileName.length - ext.length);
    const sidecarRaw = await readFile(join(sessionMediaDir, `${assetId}.json`), 'utf8').catch(
      () => null,
    );
    let createdAt = fileStat.mtime.toISOString();
    if (sidecarRaw) {
      try {
        const sidecar = JSON.parse(sidecarRaw) as { createdAt?: unknown };
        if (typeof sidecar.createdAt === 'string' && sidecar.createdAt.trim()) {
          createdAt = sidecar.createdAt;
        }
      } catch {
        // Keep filesystem mtime when the sidecar is not object JSON.
      }
    }
    items.push({
      assetId,
      createdAt,
      mimeType: MIME_BY_EXT[ext] ?? 'application/octet-stream',
      byteSize: fileStat.size,
      absolutePath,
      kind: isVideo ? 'video' : 'image',
    });
  }
  return items;
}

export async function bindOrphanGeneratedMediaToStore(input: {
  store: SessionTranscriptStore;
  sessionMediaDir: string;
  messages: readonly SessionTranscriptMessage[];
}): Promise<SessionTranscriptMessage[]> {
  const orphans = await listSessionGeneratedMedia(input.sessionMediaDir);
  const next = attachOrphansToTranscriptMessages(input.messages, orphans);
  for (let index = 0; index < next.length; index += 1) {
    const before = input.messages[index];
    const after = next[index];
    if (before === undefined || after === undefined) {
      continue;
    }
    const beforeIds = (before.attachments ?? []).map((attachment) => attachment.id).join(',');
    const afterIds = (after.attachments ?? []).map((attachment) => attachment.id).join(',');
    if (beforeIds === afterIds) {
      continue;
    }
    await input.store.updateMessage(after.id, { attachments: after.attachments ?? [] });
  }
  return next;
}
