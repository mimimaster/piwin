import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDefaultPiwinConfig,
  initPiwinConfig,
  loadPiwinConfig,
  savePiwinConfig,
} from './config-store.js';

describe('config-store', () => {
  it('round-trips config in a temp root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-'));
    const config = createDefaultPiwinConfig();
    config.hostMode = 'rpc';
    const savedPath = await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.hostMode).toBe('rpc');
    const raw = await readFile(savedPath, 'utf8');
    expect(raw).toContain('"hostMode": "rpc"');
  });

  it('init creates once', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-init-'));
    const first = await initPiwinConfig(rootDir);
    expect(first.created).toBe(true);
    const second = await initPiwinConfig(rootDir);
    expect(second.created).toBe(false);
  });

  it('preserves empty disabledIds and extraPaths arrays', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-skills-empty-'));
    const config = createDefaultPiwinConfig();
    config.skills = { extraPaths: [], disabledIds: [] };
    config.extensions = { extraPaths: [], disabledIds: [] };
    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.skills?.disabledIds).toEqual([]);
    expect(loaded.skills?.extraPaths).toEqual([]);
    expect(loaded.extensions?.disabledIds).toEqual([]);
    expect(loaded.extensions?.extraPaths).toEqual([]);
  });

  it('load/save compaction.autoEnabledDefault', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-compact-'));
    const config = createDefaultPiwinConfig();
    config.compaction = { autoEnabledDefault: false, writeTranscriptNote: false };
    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.compaction?.autoEnabledDefault).toBe(false);
  });
});
