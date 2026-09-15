import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installPiPackage } from './pi-package-installer.js';

describe('installPiPackage', () => {
  it('uses Pi package settings persistence for a user package source', async () => {
    const agentDirectory = await mkdtemp(join(tmpdir(), 'piwin-pi-package-agent-'));
    const workingDirectory = await mkdtemp(join(tmpdir(), 'piwin-pi-package-workspace-'));
    const extensionPath = join(workingDirectory, 'example.ts');
    await writeFile(extensionPath, 'export default function example() {}\n', 'utf8');

    const result = await installPiPackage({
      source: extensionPath,
      workingDirectory,
      agentDirectory,
    });

    expect(result).toEqual({ source: extensionPath, installedPath: extensionPath });
    const settings = JSON.parse(
      await readFile(join(agentDirectory, 'settings.json'), 'utf8'),
    ) as { packages?: string[] };
    expect(settings.packages).toHaveLength(1);
  });
});
