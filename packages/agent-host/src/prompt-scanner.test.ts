import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPromptEntryPaths, scanPrompts } from './prompt-scanner.js';
import { ensureBundledPromptsInstalled } from './ensure-bundled-prompts.js';

describe('prompt-scanner', () => {
  it('scans markdown templates and respects disabledIds', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-prompt-scan-'));
    const promptsDir = join(rootDir, 'prompts');
    await mkdir(promptsDir, { recursive: true });
    await writeFile(
      join(promptsDir, 'ship.md'),
      '---\ndescription: Ship checklist\n---\nShip it.\n',
      'utf8',
    );
    await writeFile(join(promptsDir, 'hide.md'), 'Hidden template\n', 'utf8');

    const listed = await scanPrompts({
      piwinRoot: rootDir,
      promptsConfig: { extraPaths: [], disabledIds: ['hide'] },
    });
    expect(listed.find((item) => item.id === 'ship')?.description).toContain('Ship');
    expect(listed.find((item) => item.id === 'hide')?.enabled).toBe(false);

    const paths = collectPromptEntryPaths({
      discovered: listed,
      disabledIds: ['hide'],
    });
    expect(paths.some((path) => path.endsWith('ship.md'))).toBe(true);
    expect(paths.some((path) => path.endsWith('hide.md'))).toBe(false);
  });

  it('installs bundled review prompt once', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-prompt-bundled-'));
    const installed = await ensureBundledPromptsInstalled(rootDir);
    expect(installed).toContain('review');
    const again = await ensureBundledPromptsInstalled(rootDir);
    expect(again).toEqual([]);
    const listed = await scanPrompts({ piwinRoot: rootDir });
    expect(listed.some((item) => item.id === 'review')).toBe(true);
  });
});
