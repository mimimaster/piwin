/**
 * media/save and chunked media/save-* — Host-owned vault writes that stay
 * inside a 1 MiB JSON frame by splitting payloads (ordinary screenshots).
 */
import type {
  HostCommand,
  HostResponse,
  MediaSaveAbortData,
  MediaSaveBeginData,
  MediaSaveChunkData,
  MediaSaveData,
} from '@piwin/contracts';
import { MEDIA_SAVE_CHUNK_MAX_BYTES, formatError } from '@piwin/contracts';
import { createMediaService, writeMediaLibraryMeta } from '@piwin/media';
import { loadPiwinConfig } from '../config-store.js';
import { decodeBase64Media } from '../media-decode.js';
import {
  abortMediaUpload,
  appendMediaUploadChunk,
  beginMediaUpload,
  concatMediaUpload,
  takeMediaUpload,
} from '../media-upload-session.js';
import { getPiwinMediaDir, getPiwinRoot } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>([
  'media/save',
  'media/save-begin',
  'media/save-chunk',
  'media/save-finish',
  'media/save-abort',
]);

export function isMediaSaveCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

async function requireMediaSession(context: HostCommandContext, sessionId: string): Promise<void> {
  if (context.requireDurableSession) {
    await context.requireDurableSession(sessionId);
  } else {
    context.requireSession(sessionId);
  }
}

function createSessionMediaService(context: HostCommandContext) {
  const rootDir = getPiwinRoot(context.piwinRoot);
  return loadPiwinConfig(rootDir).then((config) => ({
    config,
    mediaService: createMediaService({
      mediaRoot: getPiwinMediaDir(rootDir),
      maxPasteBytes: config.media.maxPasteBytes,
      allowedMimeTypes: config.media.allowedMimeTypes,
    }),
  }));
}

export async function handleMediaSaveCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!isMediaSaveCommand(command)) {
    return null;
  }

  try {
    switch (command.type) {
      case 'media/save': {
        await requireMediaSession(context, command.input.sessionId);
        const { mediaService } = await createSessionMediaService(context);
        const bytes = decodeBase64Media(command.input.base64Data);
        const asset = await mediaService.saveMediaAsset({
          sessionId: command.input.sessionId,
          bytes,
          mimeType: command.input.mimeType,
          ...(command.input.name !== undefined ? { name: command.input.name } : {}),
          ...(command.input.contentKind !== undefined
            ? { contentKind: command.input.contentKind }
            : {}),
          source: command.input.source,
        });
        await writeMediaLibraryMeta(
          { mediaRoot: getPiwinMediaDir(getPiwinRoot(context.piwinRoot)) },
          asset.sessionId,
          asset.id,
          {
            source: command.input.source,
            kind: libraryKindForMime(asset.mimeType),
            createdAt: asset.createdAt,
            ...(asset.name ? { name: asset.name } : {}),
          },
        );
        const data: MediaSaveData = { asset };
        return ok(requestId, 'media/save', data);
      }
      case 'media/save-begin': {
        await requireMediaSession(context, command.input.sessionId);
        const { config } = await createSessionMediaService(context);
        const session = beginMediaUpload({
          sessionId: command.input.sessionId,
          mimeType: command.input.mimeType,
          ...(command.input.name !== undefined ? { name: command.input.name } : {}),
          ...(command.input.contentKind !== undefined
            ? { contentKind: command.input.contentKind }
            : {}),
          source: command.input.source,
          byteSize: command.input.byteSize,
          maxPasteBytes: config.media.maxPasteBytes,
        });
        const data: MediaSaveBeginData = {
          uploadId: session.uploadId,
          chunkMaxBytes: MEDIA_SAVE_CHUNK_MAX_BYTES,
        };
        return ok(requestId, 'media/save-begin', data);
      }
      case 'media/save-chunk': {
        const { config } = await createSessionMediaService(context);
        const bytes = decodeBase64Media(command.input.base64Data);
        const session = appendMediaUploadChunk({
          uploadId: command.input.uploadId,
          chunkIndex: command.input.chunkIndex,
          bytes,
          maxPasteBytes: config.media.maxPasteBytes,
        });
        const data: MediaSaveChunkData = {
          uploadId: session.uploadId,
          receivedBytes: session.receivedBytes,
        };
        return ok(requestId, 'media/save-chunk', data);
      }
      case 'media/save-finish': {
        const assembled = takeMediaUpload(command.input.uploadId);
        await requireMediaSession(context, assembled.sessionId);
        const { mediaService } = await createSessionMediaService(context);
        const asset = await mediaService.saveMediaAsset({
          sessionId: assembled.sessionId,
          bytes: concatMediaUpload(assembled),
          mimeType: assembled.mimeType,
          ...(assembled.name !== undefined ? { name: assembled.name } : {}),
          ...(assembled.contentKind !== undefined ? { contentKind: assembled.contentKind } : {}),
          source: assembled.source,
        });
        await writeMediaLibraryMeta(
          { mediaRoot: getPiwinMediaDir(getPiwinRoot(context.piwinRoot)) },
          asset.sessionId,
          asset.id,
          {
            source: assembled.source,
            kind: libraryKindForMime(asset.mimeType),
            createdAt: asset.createdAt,
            ...(asset.name ? { name: asset.name } : {}),
          },
        );
        const data: MediaSaveData = { asset };
        return ok(requestId, 'media/save-finish', data);
      }
      case 'media/save-abort': {
        abortMediaUpload(command.input.uploadId);
        const data: MediaSaveAbortData = { uploadId: command.input.uploadId };
        return ok(requestId, 'media/save-abort', data);
      }
      default:
        return null;
    }
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}

function libraryKindForMime(mimeType: string): 'image' | 'video' | 'file' {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  return 'file';
}
