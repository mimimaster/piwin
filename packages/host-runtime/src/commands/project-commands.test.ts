import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handleProjectCommand } from './project-commands.js';

async function withProjectDir(
  run: (projectPath: string) => Promise<void>,
): Promise<void> {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), 'cm-write-file-'));
  try {
    await run(projectPath);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
}

describe('project/write-file (CM-14)', () => {
  it('writes a new file under the project root', async () => {
    await withProjectDir(async (projectPath) => {
      const response = await handleProjectCommand(
        {
          type: 'project/write-file',
          projectPath,
          relativePath: 'src/new.ts',
          content: 'export const n = 1;',
          overwrite: false,
        },
        'r1',
        undefined,
      );
      expect(response?.success).toBe(true);
      if (response?.success) {
        const data = response.data as { existed: boolean; relativePath: string };
        expect(data.existed).toBe(false);
        expect(data.relativePath).toBe('src/new.ts');
      }
      const written = await readFile(path.join(projectPath, 'src', 'new.ts'), 'utf8');
      expect(written).toBe('export const n = 1;');
    });
  });

  it('refuses overwrite unless overwrite: true', async () => {
    await withProjectDir(async (projectPath) => {
      await writeFile(path.join(projectPath, 'a.ts'), 'old', 'utf8');
      const withoutFlag = await handleProjectCommand(
        {
          type: 'project/write-file',
          projectPath,
          relativePath: 'a.ts',
          content: 'new',
          overwrite: false,
        },
        'r1',
        undefined,
      );
      expect(withoutFlag?.success).toBe(false);
      expect((await readFile(path.join(projectPath, 'a.ts'), 'utf8'))).toBe('old');

      const withFlag = await handleProjectCommand(
        {
          type: 'project/write-file',
          projectPath,
          relativePath: 'a.ts',
          content: 'new',
          overwrite: true,
        },
        'r2',
        undefined,
      );
      expect(withFlag?.success).toBe(true);
      if (withFlag?.success) {
        expect((withFlag.data as { existed: boolean }).existed).toBe(true);
      }
      expect((await readFile(path.join(projectPath, 'a.ts'), 'utf8'))).toBe('new');
    });
  });

  it('rejects path traversal outside the project root', async () => {
    await withProjectDir(async (projectPath) => {
      const response = await handleProjectCommand(
        {
          type: 'project/write-file',
          projectPath,
          relativePath: '../escape.txt',
          content: 'x',
          overwrite: false,
        },
        'r1',
        undefined,
      );
      expect(response?.success).toBe(false);
    });
  });
});
