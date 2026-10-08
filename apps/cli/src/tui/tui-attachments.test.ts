import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AttachmentQueue, MAX_PROMPT_ATTACHMENTS } from './tui-attachments.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3]);

/** A Host that accepts chunked uploads and remembers what it was sent. */
function createHost(options: { chunkMaxBytes?: number; rejectBegin?: string } = {}) {
  const commands: HostCommand[] = [];
  const uploads = new Map<string, Buffer[]>();
  const ok = (command: HostCommand, data: unknown): HostResponse => ({
    type: 'response',
    command: command.type,
    success: true,
    data,
  });
  const request = async (command: HostCommand): Promise<HostResponse> => {
    commands.push(command);
    if (command.type === 'media/save-begin') {
      if (options.rejectBegin !== undefined) {
        return { type: 'response', command: command.type, success: false, error: options.rejectBegin };
      }
      const uploadId = `upload-${uploads.size + 1}`;
      uploads.set(uploadId, []);
      return ok(command, { uploadId, chunkMaxBytes: options.chunkMaxBytes ?? 1024 });
    }
    if (command.type === 'media/save-chunk') {
      uploads.get(command.input.uploadId)?.push(Buffer.from(command.input.base64Data, 'base64'));
      return ok(command, { uploadId: command.input.uploadId, receivedBytes: 0 });
    }
    if (command.type === 'media/save-finish') {
      const begin = commands.find((entry) => entry.type === 'media/save-begin');
      const bytes = Buffer.concat(uploads.get(command.input.uploadId) ?? []);
      return ok(command, {
        asset: {
          id: `asset-${command.input.uploadId}`,
          mimeType: begin?.type === 'media/save-begin' ? begin.input.mimeType : 'image/png',
          byteSize: bytes.byteLength,
          name: begin?.type === 'media/save-begin' ? begin.input.name : undefined,
        },
      });
    }
    return ok(command, {});
  };
  return { request, commands, uploads };
}

describe('AttachmentQueue', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'piwin-attach-test-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function file(name: string, bytes: Buffer | string): Promise<string> {
    const filePath = path.join(directory, name);
    await writeFile(filePath, bytes);
    return filePath;
  }

  it('uploads in chunks and queues a Host asset reference, never a local path', async () => {
    const host = createHost({ chunkMaxBytes: 8 });
    const queue = new AttachmentQueue({ request: host.request });
    const label = await queue.addFile('session-1', await file('shot.png', PNG), 'file-picker');

    expect(label).toBe('shot.png');
    expect(Buffer.concat(host.uploads.get('upload-1') ?? [])).toEqual(PNG);
    expect(host.commands.filter((command) => command.type === 'media/save-chunk')).toHaveLength(3);
    const [pending] = queue.take();
    expect(pending?.attachment).toMatchObject({
      kind: 'media',
      path: 'remote-asset:asset-upload-1',
      mimeType: 'image/png',
      source: 'file-picker',
    });
    expect(queue.count).toBe(0);
  });

  it('recognises an image by its bytes when the name says nothing', async () => {
    const host = createHost();
    const queue = new AttachmentQueue({ request: host.request });
    await queue.addFile('session-1', await file('screenshot', PNG), 'file-picker');
    expect(host.commands[0]).toMatchObject({ type: 'media/save-begin', input: { mimeType: 'image/png', contentKind: 'image' } });
  });

  it('refuses missing, empty and unsupported files before asking the Host', async () => {
    const host = createHost();
    const queue = new AttachmentQueue({ request: host.request });
    await expect(queue.addFile('s', path.join(directory, 'nope.png'), 'file-picker')).rejects.toThrow('文件不存在');
    await expect(queue.addFile('s', await file('empty.png', ''), 'file-picker')).rejects.toThrow('文件是空的');
    await expect(queue.addFile('s', await file('blob.bin', Buffer.from([1, 2, 3, 4, 5, 6])), 'file-picker')).rejects.toThrow(
      '不支持的文件类型',
    );
    await expect(queue.addFile('s', directory, 'file-picker')).rejects.toThrow('不是文件');
    expect(host.commands).toEqual([]);
  });

  it('surfaces a Host refusal and aborts nothing it never started', async () => {
    const host = createHost({ rejectBegin: 'file exceeds 10 MB' });
    const queue = new AttachmentQueue({ request: host.request });
    await expect(queue.addFile('s', await file('big.png', PNG), 'file-picker')).rejects.toThrow('file exceeds 10 MB');
    expect(queue.count).toBe(0);
  });

  it('adopts image paths dropped into a message and leaves other paths as written', async () => {
    const host = createHost();
    const queue = new AttachmentQueue({ request: host.request });
    const shot = await file('My Shot.png', PNG);
    const notes = await file('notes.md', '# notes');
    const adopted = await queue.adoptImagePathsIn('s', `看 '${shot}' 和 ${notes} 以及 /no/such.png`);

    expect(adopted.text).toBe(`看 [图片 My Shot.png] 和 ${notes} 以及 /no/such.png`);
    expect(adopted.failures).toEqual([]);
    expect(queue.labels()).toEqual(['My Shot.png']);
  });

  it('stops at the per-prompt limit and gives taken attachments back on restore', async () => {
    const host = createHost();
    const queue = new AttachmentQueue({ request: host.request });
    const shot = await file('shot.png', PNG);
    for (let index = 0; index < MAX_PROMPT_ATTACHMENTS; index += 1) await queue.addFile('s', shot, 'file-picker');
    await expect(queue.addFile('s', shot, 'file-picker')).rejects.toThrow('最多带 8 个附件');

    const taken = queue.take();
    expect(queue.count).toBe(0);
    queue.restore(taken);
    expect(queue.count).toBe(MAX_PROMPT_ATTACHMENTS);
  });
});
