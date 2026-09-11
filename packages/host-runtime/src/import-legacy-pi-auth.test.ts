import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importLegacyPiSubscriptionAuthIfNeeded } from './import-legacy-pi-auth.js';

describe('importLegacyPiSubscriptionAuthIfNeeded', () => {
  it('does not copy Pi CLI auth into a custom/test product root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-test-root-'));
    const legacyDir = await mkdtemp(join(tmpdir(), 'pi-legacy-'));
    const legacyAuthPath = join(legacyDir, 'auth.json');
    await writeFile(legacyAuthPath, '{"xai":{"type":"oauth"}}', 'utf8');
    const result = await importLegacyPiSubscriptionAuthIfNeeded({
      piwinRoot: root,
      legacyAuthPath,
      defaultProductRoot: join(tmpdir(), 'not-this-root'),
    });
    expect(result).toBe('skipped');
    await expect(readFile(join(root, 'pi-agent', 'auth.json'), 'utf8')).rejects.toThrow();
  });

  it('copies legacy auth once into the default product root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-default-root-'));
    const legacyDir = await mkdtemp(join(tmpdir(), 'pi-legacy-'));
    const legacyAuthPath = join(legacyDir, 'auth.json');
    await writeFile(legacyAuthPath, '{"openai-codex":{"type":"oauth"}}', 'utf8');
    const first = await importLegacyPiSubscriptionAuthIfNeeded({
      piwinRoot: root,
      legacyAuthPath,
      defaultProductRoot: root,
    });
    expect(first).toBe('imported');
    expect(await readFile(join(root, 'pi-agent', 'auth.json'), 'utf8')).toBe(
      '{"openai-codex":{"type":"oauth"}}',
    );
    await writeFile(legacyAuthPath, '{"xai":{"type":"oauth"}}', 'utf8');
    const second = await importLegacyPiSubscriptionAuthIfNeeded({
      piwinRoot: root,
      legacyAuthPath,
      defaultProductRoot: root,
    });
    expect(second).toBe('already-present');
    expect(await readFile(join(root, 'pi-agent', 'auth.json'), 'utf8')).toBe(
      '{"openai-codex":{"type":"oauth"}}',
    );
  });

  it('creates the host pi-agent dir even when there is nothing to import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-empty-root-'));
    await mkdir(join(root, 'unused'), { recursive: true });
    const result = await importLegacyPiSubscriptionAuthIfNeeded({
      piwinRoot: root,
      legacyAuthPath: join(root, 'missing-auth.json'),
      defaultProductRoot: root,
    });
    expect(result).toBe('skipped');
    await expect(readFile(join(root, 'pi-agent', 'auth.json'), 'utf8')).rejects.toThrow();
  });
});
