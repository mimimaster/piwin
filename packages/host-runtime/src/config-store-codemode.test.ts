import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultPiwinConfig, loadPiwinConfig } from './config-store.js';

describe('Codemode default configuration', () => {
  it('enables Codemode in a fresh Host config', () => {
    expect(createDefaultPiwinConfig().codemode?.enabled).toBe(true);
  });

  it.each([
    { label: 'legacy config without the domain', codemode: undefined, enabled: true, maxCalls: 32 },
    { label: 'empty domain', codemode: {}, enabled: true, maxCalls: 32 },
    { label: 'limits without an enable flag', codemode: { maxCalls: 2 }, enabled: true, maxCalls: 2 },
    { label: 'explicit rollback override', codemode: { enabled: false, maxCalls: 2 }, enabled: false, maxCalls: 2 },
  ])('loads $label without rewriting the user file', async ({ codemode, enabled, maxCalls }) => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-codemode-config-'));
    const path = join(root, 'config.json');
    const raw = JSON.stringify({ hostMode: 'sdk', codemode });
    try {
      await writeFile(path, raw, 'utf8');
      const loaded = await loadPiwinConfig(root);
      expect(loaded.codemode).toMatchObject({ enabled, maxCalls });
      expect(await readFile(path, 'utf8')).toBe(raw);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
