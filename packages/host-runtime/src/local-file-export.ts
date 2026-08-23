/**
 * Local-Host user-gesture export of a clicked path for Desktop Save As.
 *
 * Returns whole-file bytes (base64). Binary is allowed up to a hard cap.
 * Remote clients never call this — host-server rejects the command.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  inferAttachmentMimeType,
  type LocalFileExportData,
  type LocalFileExportFailureReason,
} from '@piwin/contracts';

/** Default soft cap when the client omits maxBytes. */
export const LOCAL_FILE_EXPORT_DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
/** Hard ceiling regardless of client maxBytes. */
export const LOCAL_FILE_EXPORT_HARD_MAX_BYTES = 64 * 1024 * 1024;

const DENIED_PATH_SEGMENTS = [
  '/.ssh/',
  '/.aws/',
  '/.piwin/credentials/',
  '/.gnupg/',
  '/.kube/',
];

export type ExportLocalFileInput = {
  absolutePath: string;
  maxBytes?: number;
};

export async function exportLocalFile(input: ExportLocalFileInput): Promise<LocalFileExportData> {
  const absolutePath = input.absolutePath.trim();
  if (!isAbsoluteFilesystemPath(absolutePath) || absolutePath.includes('\0')) {
    return unavailable('invalid-request', 'Provide an absolute file path.');
  }

  const requestedMax =
    typeof input.maxBytes === 'number' && Number.isSafeInteger(input.maxBytes) && input.maxBytes > 0
      ? input.maxBytes
      : LOCAL_FILE_EXPORT_DEFAULT_MAX_BYTES;
  const maxBytes = Math.min(requestedMax, LOCAL_FILE_EXPORT_HARD_MAX_BYTES);

  let fileStats;
  try {
    fileStats = await stat(absolutePath);
  } catch {
    return unavailable('not-found', '该文件不存在或已被清理。');
  }
  if (!fileStats.isFile()) {
    return unavailable('not-a-file', '该路径不是可导出的文件。');
  }
  if (fileStats.size > maxBytes) {
    return unavailable('too-large', `文件超过导出上限（${formatBytes(maxBytes)}）。`);
  }

  let realAbsolute: string;
  try {
    realAbsolute = await realpath(absolutePath);
  } catch {
    return unavailable('not-found', '该文件不存在或已被清理。');
  }

  if (isDeniedExportLocation(realAbsolute)) {
    return unavailable('denied-location', '出于安全原因，该位置的文件不能导出。');
  }

  try {
    const bytes = await readFile(realAbsolute);
    if (bytes.byteLength > maxBytes) {
      return unavailable('too-large', `文件超过导出上限（${formatBytes(maxBytes)}）。`);
    }
    const fileName = basename(absolutePath) || 'download.bin';
    const mimeType =
      inferAttachmentMimeType(fileName, undefined, bytes.subarray(0, 16)) ??
      'application/octet-stream';
    return {
      status: 'ready',
      fileName,
      mimeType,
      byteSize: bytes.byteLength,
      base64Data: bytes.toString('base64'),
    };
  } catch {
    return unavailable('not-found', '无法读取该文件。');
  }
}

function unavailable(
  reason: LocalFileExportFailureReason,
  suggestion?: string,
): LocalFileExportData {
  return suggestion === undefined
    ? { status: 'unavailable', reason }
    : { status: 'unavailable', reason, suggestion };
}

function isAbsoluteFilesystemPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function isDeniedExportLocation(absolutePath: string): boolean {
  const normalized = absolutePath.replace(/\\/g, '/');
  return DENIED_PATH_SEGMENTS.some((segment) => normalized.includes(segment));
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${Math.round(value / (1024 * 1024))} MiB`;
  }
  return `${value} B`;
}
