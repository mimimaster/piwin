/**
 * Local-Host user-gesture preview of a clicked path (ADR 0052 Slice 4).
 *
 * Whatever the UI can render, it renders: raster images are copied into the
 * session media vault; text is returned inline (truncated). Binary files that
 * are neither image nor text stay unavailable with reason `binary` — never
 * `outside-project`. Remote clients never call this.
 */
import { open, realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  contentKindForMimeType,
  inferAttachmentMimeType,
  type LocalFilePreviewData,
  type LocalFilePreviewFailureReason,
} from '@piwin/contracts';
import { createMediaService } from '@piwin/media';

const SNIFF_BYTES = 16;
const TEXT_SAMPLE_BYTES = 8_000;
const TEXT_DEFAULT_MAX_BYTES = 256 * 1024;
const TEXT_HARD_MAX_BYTES = 512 * 1024;

export type PreviewLocalFileInput = {
  absolutePath: string;
  sessionId: string;
  mediaRoot: string;
  maxImageBytes: number;
  allowedMimeTypes: readonly string[];
};

export async function previewLocalFile(input: PreviewLocalFileInput): Promise<LocalFilePreviewData> {
  const absolutePath = input.absolutePath.trim();
  if (!isAbsoluteFilesystemPath(absolutePath) || absolutePath.includes('\0')) {
    return unavailable('invalid-request', 'Provide an absolute file path.');
  }
  if (!Number.isSafeInteger(input.maxImageBytes) || input.maxImageBytes <= 0) {
    return unavailable('invalid-request');
  }

  let fileStats;
  try {
    fileStats = await stat(absolutePath);
  } catch {
    return unavailable('not-found', '该文件不存在或已被清理。');
  }
  if (!fileStats.isFile()) {
    return unavailable('not-a-file', '该路径不是可预览的文件。');
  }

  let realAbsolute: string;
  try {
    realAbsolute = await realpath(absolutePath);
  } catch {
    return unavailable('not-found', '该文件不存在或已被清理。');
  }

  if (fileStats.size === 0) {
    return {
      status: 'ready',
      kind: 'text',
      content: '',
      byteSize: 0,
      truncated: false,
      readOnly: true,
    };
  }

  let handle;
  try {
    handle = await open(realAbsolute, 'r');
  } catch {
    return unavailable('not-found', '该文件不存在或已被清理。');
  }

  try {
    const header = await readPrefix(handle, Math.min(fileStats.size, SNIFF_BYTES));
    const sniffed = inferAttachmentMimeType('preview.bin', undefined, header);
    if (sniffed !== null && contentKindForMimeType(sniffed) === 'image') {
      if (fileStats.size > input.maxImageBytes) {
        return unavailable('too-large', '图片超出预览大小上限。');
      }
      const bytes = await readPrefix(handle, fileStats.size);
      return ingestImage({
        sessionId: input.sessionId,
        mediaRoot: input.mediaRoot,
        maxImageBytes: input.maxImageBytes,
        allowedMimeTypes: input.allowedMimeTypes,
        bytes,
        mimeType: sniffed,
        name: basename(absolutePath),
      });
    }

    const maxTextBytes = Math.min(TEXT_HARD_MAX_BYTES, TEXT_DEFAULT_MAX_BYTES);
    const textBytes = await readPrefix(handle, Math.min(fileStats.size, maxTextBytes));
    const sample = textBytes.subarray(0, Math.min(textBytes.byteLength, TEXT_SAMPLE_BYTES));
    if (sample.includes(0)) {
      return unavailable('binary', '该文件不是可预览的文本或图片。');
    }
    return {
      status: 'ready',
      kind: 'text',
      content: textBytes.toString('utf8'),
      byteSize: fileStats.size,
      truncated: fileStats.size > maxTextBytes,
      readOnly: true,
    };
  } catch {
    return unavailable('not-found', '该文件不存在或已被清理。');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function readPrefix(
  handle: Awaited<ReturnType<typeof open>>,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const result = await handle.read(buffer, 0, length, 0);
  return result.bytesRead === length ? buffer : buffer.subarray(0, result.bytesRead);
}

async function ingestImage(input: {
  sessionId: string;
  mediaRoot: string;
  maxImageBytes: number;
  allowedMimeTypes: readonly string[];
  bytes: Buffer;
  mimeType: string;
  name: string;
}): Promise<LocalFilePreviewData> {
  const mediaService = createMediaService({
    mediaRoot: input.mediaRoot,
    maxPasteBytes: input.maxImageBytes,
    allowedMimeTypes: [...input.allowedMimeTypes],
  });
  try {
    const asset = await mediaService.saveMediaAsset({
      sessionId: input.sessionId,
      bytes: new Uint8Array(input.bytes),
      mimeType: input.mimeType,
      name: input.name,
      contentKind: 'image',
      source: 'file-picker',
    });
    return { status: 'ready', kind: 'media', asset };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('media too large:')) {
      return unavailable('too-large', '图片超出预览大小上限。');
    }
    if (message.startsWith('mime type not allowed:')) {
      return unavailable('binary', '该文件不是可预览的文本或图片。');
    }
    return unavailable('not-found', '无法写入会话媒体库。');
  }
}

function unavailable(
  reason: LocalFilePreviewFailureReason,
  suggestion?: string,
): LocalFilePreviewData {
  return suggestion === undefined
    ? { status: 'unavailable', reason }
    : { status: 'unavailable', reason, suggestion };
}

function isAbsoluteFilesystemPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}
