import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPiwinConfig, loadPiwinConfig, savePiwinConfig } from '@piwin/host-runtime';
import { commandSystemPrompts } from './system-prompts-command.js';

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'piwin-cli-sysprompts-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = undefined;
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('piwin system-prompts CLI', () => {
  it('lists, shows stacked .md/.txt files, and switches global and project presets', async () => {
    const root = makeTempRoot();
    vi.stubEnv('PIWIN_ROOT', root);

    const fileA = join(root, 'base.md');
    const fileB = join(root, 'rules.txt');
    writeFileSync(fileA, 'Be concise and direct.', 'utf8');
    writeFileSync(fileB, 'Cite file paths.', 'utf8');

    const cfg = createDefaultPiwinConfig();
    await savePiwinConfig(
      {
        ...cfg,
        systemPrompts: {
          presets: [
            {
              id: 'concise',
              name: 'Concise Helper',
              mode: 'append',
              filePaths: [fileA, fileB],
              updatedAt: '2026-11-17T00:00:00.000Z',
            },
          ],
        },
      },
      root,
    );

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    await commandSystemPrompts(['system-prompts', 'list']);
    const listOutput = logs.join('\n');
    expect(listOutput).toContain('concise');
    expect(listOutput).toContain('@base.md -> @rules.txt');
    expect(listOutput).toContain('agent.default');

    logs.length = 0;
    await commandSystemPrompts(['system-prompts', 'show', 'concise']);
    const showOutput = logs.join('\n');
    expect(showOutput).toContain('Be concise and direct.');
    expect(showOutput).toContain('Cite file paths.');

    await commandSystemPrompts(['system-prompts', 'use', 'concise']);
    let updated = await loadPiwinConfig(root);
    expect(updated.systemPrompts?.defaultPresetId).toBe('concise');

    await commandSystemPrompts(['system-prompts', 'use', 'concise', '--project', '/repo/demo']);
    updated = await loadPiwinConfig(root);
    expect(updated.systemPrompts?.projectPresetIds?.['/repo/demo']).toBe('concise');

    await commandSystemPrompts(['system-prompts', 'use', 'default']);
    updated = await loadPiwinConfig(root);
    expect(updated.systemPrompts?.defaultPresetId).toBeUndefined();
  });
});
