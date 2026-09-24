/**
 * Config-root text reader for ADR 0052 Slice 3.
 *
 * Authority is store identity: the path must stay under the Host config root
 * after lexical resolve + realpath. Media vault files are rejected so they
 * cannot bypass `media/read`. Callers never supply a host-absolute path.
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  configStoreDisplayRef,
  type TrustedTextReadData,
  type TrustedTextReadFailureReason,
} from '@piwin/contracts';
import { resolveInsideRootWithRealpath } from '@piwin/project';
import { getPiwinMediaDir } from './paths.js';

const DEFAULT_MAX_BYTES = 256 * 1024;
const HARD_MAX_BYTES = 512 * 1024;

export type ReadTrustedTextInput = {
  piwinRoot: string;
  relativePath: string;
  maxBytes?: number;
};

export async function readTrustedConfigText(
  input: ReadTrustedTextInput,
): Promise<TrustedTextReadData> {
  const display = (relativePath: string): string => configStoreDisplayRef(input.piwinRoot, relativePath);
  const unavailable = (
    reason: TrustedTextReadFailureReason,
    relativePath: string,
    suggestion?: string,
  ): TrustedTextReadData => ({
    status: 'unavailable',
    reason,
    displayRef: display(relativePath.trim().replace(/^\/+/, '')),
    ...(suggestion ? { suggestion } : {}),
  });
  const relativeNormalized = normalizeTrustedRelativePath(input.relativePath);
  if (relativeNormalized === null) {
    return unavailable('invalid-request', input.relativePath, 'Provide a config-root-relative path.');
  }
  if (isMediaVaultRelativePath(relativeNormalized)) {
    return unavailable(
      'media-vault',
      relativeNormalized,
      '会话媒体请通过媒体预览通道打开，不能作为文本读取。',
    );
  }

  const resolved = await resolveInsideRootWithRealpath(input.piwinRoot, relativeNormalized);
  if (!resolved.ok) {
    return unavailable(
      mapContainmentReason(resolved.reason),
      relativeNormalized,
      '该路径不在受信配置根内，或已被清理。',
    );
  }

  const targetAbsolute = resolved.realAbsolute ?? resolved.absolute;
  if (isPathInsideMediaRoot(input.piwinRoot, targetAbsolute)) {
    return unavailable(
      'media-vault',
      relativeNormalized,
      '会话媒体请通过媒体预览通道打开，不能作为文本读取。',
    );
  }

  const maxBytes = Math.min(HARD_MAX_BYTES, Math.max(1024, input.maxBytes ?? DEFAULT_MAX_BYTES));

  let fileStats;
  try {
    fileStats = await stat(targetAbsolute);
  } catch {
    return unavailable('not-found', relativeNormalized);
  }
  if (!fileStats.isFile()) {
    return unavailable('not-a-file', relativeNormalized);
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(targetAbsolute);
  } catch {
    return unavailable('not-found', relativeNormalized);
  }

  const byteSize = buffer.byteLength;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  if (sample.includes(0)) {
    return unavailable('binary', relativeNormalized, '该文件不是可预览的文本。');
  }

  let truncated = false;
  let contentBuffer = buffer;
  if (contentBuffer.byteLength > maxBytes) {
    contentBuffer = contentBuffer.subarray(0, maxBytes);
    truncated = true;
  }

  return {
    status: 'ready',
    relativePath: relativeNormalized,
    displayRef: display(relativeNormalized),
    content: contentBuffer.toString('utf8'),
    byteSize,
    truncated,
    readOnly: true,
  };
}

/**
 * Rejects empty, absolute, traversal, and overlong relative paths before any FS
 * hop. The Host still re-validates with realpath containment.
 */
export function normalizeTrustedRelativePath(relativePath: string): string | null {
  const trimmed = relativePath.trim();
  if (!trimmed || trimmed.length > 512) {
    return null;
  }
  const posix = trimmed.replace(/\\/g, '/');
  if (posix.startsWith('/') || /^[A-Za-z]:\//.test(posix)) {
    return null;
  }
  const normalized = posix.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized.includes('..')) {
    return null;
  }
  return normalized;
}

export function isMediaVaultRelativePath(relativePath: string): boolean {
  return relativePath === 'media' || relativePath.startsWith('media/');
}

function isPathInsideMediaRoot(piwinRoot: string, absolutePath: string): boolean {
  const mediaRoot = resolve(getPiwinMediaDir(piwinRoot));
  const target = resolve(absolutePath);
  return target === mediaRoot || target.startsWith(`${mediaRoot}/`) || target.startsWith(`${mediaRoot}\\`);
}

function mapContainmentReason(reason: string): TrustedTextReadFailureReason {
  if (reason.includes('does not exist') || reason === 'path does not exist') {
    return 'not-found';
  }
  return 'outside-config-root';
}
