import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HostRuntime } from '../host-runtime.js';
import { handleHostCreateEntry } from './host-create-entry.js';

let rootDir: string;
beforeEach(async () => {
  rootDir = await realpath(await mkdtemp(join(os.tmpdir(), 'piwin-entry-command-')));
});
afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('host/create-entry', () => {
  it('returns the created entry through the Host response', async () => {
    const response = await handleHostCreateEntry(
      {
        type: 'host/create-entry',
        input: {
          parentPath: rootDir,
          name: 'new',
          kind: 'directory',
        },
      },
      'create-1',
    );
    expect(response).toMatchObject({
      id: 'create-1',
      success: true,
      command: 'host/create-entry',
      data: { name: 'new', path: join(rootDir, 'new'), kind: 'directory' },
    });
    expect((await stat(join(rootDir, 'new'))).isDirectory()).toBe(true);
  });
  it('returns a stable structured collision error without a stack trace', async () => {
    const command = {
      type: 'host/create-entry',
      input: { parentPath: rootDir, name: 'file.txt', kind: 'file' },
    } as const;
    await handleHostCreateEntry(command, undefined);
    const response = await handleHostCreateEntry(command, undefined);
    expect(response).toMatchObject({
      success: false,
      problem: { code: 'host-entry-already-exists' },
    });
    if (response.success) throw new Error('Expected a collision');
    expect(response.error).not.toContain(rootDir);
    expect(response.error).not.toContain('Error:');
  });
});

describe('HostRuntime entry creation dispatch', () => {
  it.each(['sdk', 'rpc'] as const)(
    'creates and lists an entry through the %s Host command boundary',
    async (mode) => {
      const runtime = new HostRuntime({ mode, mock: true, piwinRoot: join(rootDir, 'authority') });
      try {
        const created = await runtime.handleCommand({
          type: 'host/create-entry',
          id: 'create',
          input: {
            parentPath: rootDir,
            name: 'workspace',
            kind: 'directory',
          },
        });
        expect(created).toMatchObject({
          id: 'create',
          success: true,
          data: { path: join(rootDir, 'workspace') },
        });
        const listed = await runtime.handleCommand({ type: 'host/list-dir', path: rootDir });
        expect(listed).toMatchObject({
          success: true,
          data: {
            entries: expect.arrayContaining([
              { name: 'workspace', kind: 'directory', path: join(rootDir, 'workspace') },
            ]),
          },
        });
      } finally {
        await runtime.dispose();
      }
    },
  );
});
