import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ExtensionRegistryIndex } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { getExtensionRegistryIndexUrl, installExtensionFromSource } from './extension-registry-install.js';

const run = promisify(execFile);

async function commitFile(repo: string, content: string): Promise<string> {
  await writeFile(join(repo, 'index.ts'), content, 'utf8');
  await run('git', ['add', '.'], { cwd: repo });
  await run('git', ['commit', '-q', '-m', content], { cwd: repo });
  return (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
}

describe('installExtensionFromSource', () => {
  it('stages the registry version pinned commit under an owner-qualified id', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'piwin-registry-src-'));
    await run('git', ['init', '-q'], { cwd: repo });
    await run('git', ['config', 'user.email', 't@t.test'], { cwd: repo });
    await run('git', ['config', 'user.name', 'Test'], { cwd: repo });
    const v1 = await commitFile(repo, 'export const version = 1;\n');
    const v2 = await commitFile(repo, 'export const version = 2;\n');
    const index: ExtensionRegistryIndex = {
      schemaVersion: 1,
      generatedAt: '',
      extensions: [
        {
          id: 'alice/demo',
          name: 'Demo',
          description: '',
          owners: ['alice'],
          // The parser only admits GitHub URLs; the resolver trusts parsed input.
          repository: repo,
          license: 'MIT',
          versions: [
            { version: '2.0.0', commit: v2, yanked: { reason: 'bad' } },
            { version: '1.0.0', commit: v1 },
          ],
        },
      ],
    };
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-registry-root-'));
    const result = await installExtensionFromSource({
      piwinRoot,
      source: { kind: 'registry', id: 'alice/demo' },
      loadRegistryIndex: async () => index,
    });
    expect(result.extensionId).toBe('alice-demo');
    expect(result.registry).toEqual({ id: 'alice/demo', version: '1.0.0', commit: v1 });
    expect(await readFile(join(result.packageRoot, 'index.ts'), 'utf8')).toContain('version = 1');
    await expect(
      installExtensionFromSource({
        piwinRoot,
        source: { kind: 'registry', id: 'alice/demo', version: '2.0.0' },
        loadRegistryIndex: async () => index,
      }),
    ).rejects.toThrow(/yanked: bad/);
  });

  it('reads the registry URL override from the environment', () => {
    expect(getExtensionRegistryIndexUrl({ PIWIN_EXTENSION_REGISTRY_URL: ' https://x.test/i.json ' })).toBe(
      'https://x.test/i.json',
    );
    expect(getExtensionRegistryIndexUrl({})).toMatch(/piwin-extensions\/index\.json$/);
  });
});
