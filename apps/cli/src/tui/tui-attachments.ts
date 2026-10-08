import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import type { HostCommand, HostResponse, PromptAttachment } from '@piwin/contracts';
import { contentKindForMimeType, inferAttachmentMimeType, toMediaAttachmentRef } from '@piwin/contracts';
import { saveMediaOverHost } from '@piwin/host-client';
import { findAbsolutePathTokens } from './attachment-paths.js';

/** The remote protocol accepts at most 8 attachments per prompt. */
export const MAX_PROMPT_ATTACHMENTS = 8;
/** Enough to recognise an image by its signature when the name says nothing. */
const HEADER_BYTES = 16;

export type PendingAttachment = {
  attachment: PromptAttachment;
  /** Shown in the status line and under the sent message. */
  label: string;
};

export type AttachmentUploaderOptions = {
  request: (command: HostCommand) => Promise<HostResponse>;
};

export class AttachmentError extends Error {
  public readonly name = 'AttachmentError';
}

/**
 * Attachments waiting for the next prompt. Bytes are read on the TUI's
 * machine and uploaded to the Host's media vault, so this works the same
 * whether the Host is local or remote; the prompt then carries only the
 * Host's asset reference.
 */
export class AttachmentQueue {
  private pending: PendingAttachment[] = [];

  public constructor(private readonly options: AttachmentUploaderOptions) {}

  public get count(): number {
    return this.pending.length;
  }

  public labels(): string[] {
    return this.pending.map((entry) => entry.label);
  }

  public clear(): number {
    const cleared = this.pending.length;
    this.pending = [];
    return cleared;
  }

  /** Hand the queue to a prompt; a failed send puts it back with `restore`. */
  public take(): PendingAttachment[] {
    const taken = this.pending;
    this.pending = [];
    return taken;
  }

  public restore(taken: readonly PendingAttachment[]): void {
    this.pending = [...taken, ...this.pending].slice(0, MAX_PROMPT_ATTACHMENTS);
  }

  public async addFile(sessionId: string, filePath: string, source: 'file-picker' | 'drop'): Promise<string> {
    const { bytes, mimeType } = await readAttachableFile(filePath);
    return this.upload(sessionId, bytes, mimeType, path.basename(filePath), source);
  }

  public addImageBytes(sessionId: string, bytes: Uint8Array, mimeType: string, name: string): Promise<string> {
    return this.upload(sessionId, bytes, mimeType, name, 'paste');
  }

  /**
   * Image paths written inside a message (a file dropped on the terminal)
   * become attachments and leave a short marker behind. Other paths stay as
   * the user wrote them: mentioning a path is not asking to upload it.
   */
  public async adoptImagePathsIn(sessionId: string, text: string): Promise<{ text: string; failures: string[] }> {
    let rewritten = text;
    const failures: string[] = [];
    for (const token of findAbsolutePathTokens(text)) {
      if (!(await isImageFile(token.path))) continue;
      try {
        const label = await this.addFile(sessionId, token.path, 'drop');
        rewritten = rewritten.split(token.raw).join(`[图片 ${label}]`);
      } catch (error) {
        failures.push(`${path.basename(token.path)}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { text: rewritten, failures };
  }

  private async upload(
    sessionId: string,
    bytes: Uint8Array,
    mimeType: string,
    name: string,
    source: 'file-picker' | 'drop' | 'paste',
  ): Promise<string> {
    if (this.pending.length >= MAX_PROMPT_ATTACHMENTS) {
      throw new AttachmentError(`一条消息最多带 ${MAX_PROMPT_ATTACHMENTS} 个附件`);
    }
    const contentKind = contentKindForMimeType(mimeType);
    const asset = await saveMediaOverHost({
      request: this.options.request,
      encodeBase64: (chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('base64'),
      sessionId,
      bytes,
      mimeType,
      source,
      name,
      ...(contentKind === null ? {} : { contentKind }),
    });
    // The upload awaited; another attachment may have filled the last slot.
    if (this.pending.length >= MAX_PROMPT_ATTACHMENTS) {
      throw new AttachmentError(`一条消息最多带 ${MAX_PROMPT_ATTACHMENTS} 个附件`);
    }
    const label = asset.name ?? name;
    this.pending.push({ attachment: toMediaAttachmentRef(asset, source), label });
    return label;
  }
}

async function readAttachableFile(filePath: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const info = await stat(filePath).catch(() => undefined);
  if (info === undefined) throw new AttachmentError('文件不存在');
  if (!info.isFile()) throw new AttachmentError('不是文件');
  if (info.size === 0) throw new AttachmentError('文件是空的');
  const handle = await open(filePath, 'r');
  try {
    const bytes = new Uint8Array(await handle.readFile());
    const mimeType = inferAttachmentMimeType(path.basename(filePath), undefined, bytes.subarray(0, HEADER_BYTES));
    if (mimeType === null) throw new AttachmentError('不支持的文件类型');
    return { bytes, mimeType };
  } finally {
    await handle.close();
  }
}

/** Decided from the first bytes and the name, without reading the whole file. */
async function isImageFile(filePath: string): Promise<boolean> {
  const info = await stat(filePath).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.size === 0) return false;
  const handle = await open(filePath, 'r').catch(() => undefined);
  if (handle === undefined) return false;
  try {
    const header = new Uint8Array(HEADER_BYTES);
    const { bytesRead } = await handle.read(header, 0, HEADER_BYTES, 0);
    const mimeType = inferAttachmentMimeType(path.basename(filePath), undefined, header.subarray(0, bytesRead));
    return mimeType !== null && contentKindForMimeType(mimeType) === 'image';
  } finally {
    await handle.close();
  }
}
