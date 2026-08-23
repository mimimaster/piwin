import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  exportLocalFile,
  LOCAL_FILE_EXPORT_DEFAULT_MAX_BYTES,
} from './local-file-export.js';

describe('exportLocalFile', () => {
  it('exports binary bytes as base64', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-export-'));
    const path = join(root, 'shot.zip');
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
    await writeFile(path, bytes);

    const result = await exportLocalFile({ absolutePath: path });
    expect(result).toMatchObject({
      status: 'ready',
      fileName: 'shot.zip',
      byteSize: bytes.byteLength,
    });
    if (result.status === 'ready') {
      expect(Buffer.from(result.base64Data, 'base64')).toEqual(bytes);
    }
  });

  it('rejects relative paths', async () => {
    const result = await exportLocalFile({ absolutePath: 'relative/out.zip' });
    expect(result).toEqual({
      status: 'unavailable',
      reason: 'invalid-request',
      suggestion: 'Provide an absolute file path.',
    });
  });

  it('rejects oversized files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-export-big-'));
    const path = join(root, 'big.bin');
    await writeFile(path, Buffer.alloc(64));
    const result = await exportLocalFile({ absolutePath: path, maxBytes: 32 });
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toBe('too-large');
    }
  });

  it('rejects directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-export-dir-'));
    const dir = join(root, 'folder');
    await mkdir(dir);
    const result = await exportLocalFile({ absolutePath: dir });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'not-a-file' });
  });

  it('uses the default max when omitted', () => {
    expect(LOCAL_FILE_EXPORT_DEFAULT_MAX_BYTES).toBe(32 * 1024 * 1024);
  });
});
