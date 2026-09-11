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

const USER_VAULT_SOURCES = new Set(['paste', 'drop', 'file-picker']);

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

/**
 * Resume/messages only see a bounded tail page. Paste/drop screenshots whose
 * user rows already left that page look "unreferenced" and used to be rewritten
 * onto the latest assistant as `source: generated`. Strip those back off.
 */
export function detachUserOwnedMediaFromAssistants(
  messages: readonly SessionTranscriptMessage[],
  userOwnedAssetIds: ReadonlySet<string>,
): SessionTranscriptMessage[] {
  if (userOwnedAssetIds.size === 0 || messages.length === 0) {
    return [...messages];
  }
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== 'assistant' || !message.attachments || message.attachments.length === 0) {
      return message;
    }
    const attachments = message.attachments.filter(
      (attachment) => !userOwnedAssetIds.has(attachment.id),
    );
    if (attachments.length === message.attachments.length) {
      return message;
    }
    changed = true;
    if (attachments.length === 0) {
      const { attachments: _removed, ...rest } = message;
      return rest;
    }
    return { ...message, attachments };
  });
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
    // A missing timestamp is not a license to dump the asset on whatever
    // assistant happens to be last in this bounded page.
    return -1;
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
  if (lastUserIndex === -1) {
    return -1;
  }
  const start = lastUserIndex + 1;
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      break;
    }
    if (message?.role === 'assistant') {
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

type VaultSidecar = {
  createdAt?: unknown;
  source?: unknown;
};

type SessionVaultMediaScan = {
  generated: OrphanGeneratedMedia[];
  userOwnedAssetIds: Set<string>;
};

export async function listSessionGeneratedMedia(
  sessionMediaDir: string,
): Promise<OrphanGeneratedMedia[]> {
  return (await scanSessionVaultMedia(sessionMediaDir)).generated;
}

async function scanSessionVaultMedia(sessionMediaDir: string): Promise<SessionVaultMediaScan> {
  const files = await readdir(sessionMediaDir).catch(() => []);
  const generated: OrphanGeneratedMedia[] = [];
  const userOwnedAssetIds = new Set<string>();
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
    const sidecar = parseVaultSidecar(sidecarRaw);
    if (typeof sidecar.source === 'string' && USER_VAULT_SOURCES.has(sidecar.source)) {
      userOwnedAssetIds.add(assetId);
      continue;
    }
    // Studio library and this binder are generated-output only. Chat paste /
    // drop / picker files stay on the user row that saved them.
    if (sidecar.source !== 'generated') {
      continue;
    }
    const createdAt =
      typeof sidecar.createdAt === 'string' && sidecar.createdAt.trim()
        ? sidecar.createdAt
        : fileStat.mtime.toISOString();
    generated.push({
      assetId,
      createdAt,
      mimeType: MIME_BY_EXT[ext] ?? 'application/octet-stream',
      byteSize: fileStat.size,
      absolutePath,
      kind: isVideo ? 'video' : 'image',
    });
  }
  return { generated, userOwnedAssetIds };
}

function parseVaultSidecar(raw: string | null): VaultSidecar {
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed as VaultSidecar;
  } catch {
    return {};
  }
}

export async function bindOrphanGeneratedMediaToStore(input: {
  store: SessionTranscriptStore;
  sessionMediaDir: string;
  messages: readonly SessionTranscriptMessage[];
}): Promise<SessionTranscriptMessage[]> {
  const scan = await scanSessionVaultMedia(input.sessionMediaDir);
  const stripped = detachUserOwnedMediaFromAssistants(input.messages, scan.userOwnedAssetIds);
  const next = attachOrphansToTranscriptMessages(stripped, scan.generated);
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
