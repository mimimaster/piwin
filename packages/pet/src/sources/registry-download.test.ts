import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadAndVerifyPackage } from './registry-download.js';

function makeZipBuffer(): Buffer {
  // Minimal ZIP magic bytes (PK\x03\x04) — enough for magic-byte validation.
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('rest-of-zip'),
  ]);
}

describe('downloadAndVerifyPackage', () => {
  it('writes the file and verifies sha256 against a stub fetch', async () => {
    const buf = makeZipBuffer();
    const sha = createHash('sha256').update(buf).digest('hex');
    const dest = await mkdtemp(join(tmpdir(), 'piwin-pet-dl-'));
    const entry = {
      id: 'remote-pet',
      displayName: 'Remote',
      url: 'https://example.test/pet.zip',
      sha256: sha,
      sizeBytes: buf.byteLength,
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new Blob([buf]).stream(),
    }));
    const result = await downloadAndVerifyPackage(entry, dest, { fetch: fetchMock as never });
    expect(result.filePath).toMatch(/pet\.zip$/);
    expect(await readFile(result.filePath)).toEqual(buf);
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/pet.zip', expect.any(Object));
  });

  it('rejects when sha256 mismatches', async () => {
    const buf = makeZipBuffer();
    const dest = await mkdtemp(join(tmpdir(), 'piwin-pet-dl-'));
    const entry = {
      id: 'remote-pet',
      displayName: 'Remote',
      url: 'https://example.test/pet.zip',
      sha256: '0'.repeat(64),
      sizeBytes: buf.byteLength,
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new Blob([buf]).stream(),
    }));
    await expect(
      downloadAndVerifyPackage(entry, dest, { fetch: fetchMock as never }),
    ).rejects.toThrow(/sha256/i);
  });

  it('rejects non-https urls', async () => {
    const dest = await mkdtemp(join(tmpdir(), 'piwin-pet-dl-'));
    const entry = {
      id: 'x',
      displayName: 'x',
      url: 'http://insecure.test/pet.zip',
      sha256: '0'.repeat(64),
      sizeBytes: 1,
    };
    await expect(downloadAndVerifyPackage(entry, dest)).rejects.toThrow(/https/i);
  });
});
