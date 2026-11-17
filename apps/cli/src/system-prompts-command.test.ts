import { mkdtempSync, rmSync } from 'node:fs';
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
  it('lists, shows, and switches global and project presets', async () => {
    const root = makeTempRoot();
    vi.stubEnv('PIWIN_ROOT', root);

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
              content: 'Be concise and direct.',
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
    expect(logs.join('\n')).toContain('concise');
    expect(logs.join('\n')).toContain('agent.default');

    logs.length = 0;
    await commandSystemPrompts(['system-prompts', 'show', 'concise']);
    expect(logs.join('\n')).toContain('Be concise and direct.');

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
