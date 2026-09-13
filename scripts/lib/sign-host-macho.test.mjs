import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import {
  buildCodesignArgs,
  collectMachOFiles,
  isMachOMagic,
} from './sign-host-macho.mjs';

test('isMachOMagic accepts 64-bit and fat headers', () => {
  const macho64 = Buffer.alloc(4);
  macho64.writeUInt32BE(0xfeedfacf, 0);
  assert.equal(isMachOMagic(macho64), true);

  const fat = Buffer.alloc(4);
  fat.writeUInt32BE(0xcafebabe, 0);
  assert.equal(isMachOMagic(fat), true);

  assert.equal(isMachOMagic(Buffer.from('#!/b')), false);
  assert.equal(isMachOMagic(Buffer.alloc(2)), false);
});

test('collectMachOFiles skips text and follows only regular files', async () => {
  const root = join(tmpdir(), `piwin-macho-${process.pid}-${Date.now()}`);
  await mkdir(join(root, 'bin'), { recursive: true });
  const macho = Buffer.alloc(16);
  macho.writeUInt32BE(0xfeedfacf, 0);
  await writeFile(join(root, 'bin', 'tool'), macho);
  await writeFile(join(root, 'readme.txt'), 'not a binary');

  try {
    const found = await collectMachOFiles(root);
    assert.deepEqual(found, [join(root, 'bin', 'tool')]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildCodesignArgs uses hardened runtime and timestamp', () => {
  assert.deepEqual(
    buildCodesignArgs({
      identity: 'Developer ID Application: Example (TEAMID)',
      file: '/tmp/lib.node',
    }),
    [
      '--force',
      '--options',
      'runtime',
      '--timestamp',
      '--sign',
      'Developer ID Application: Example (TEAMID)',
      '/tmp/lib.node',
    ],
  );
});
