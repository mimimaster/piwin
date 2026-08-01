import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

  it('round-trips desktop model, effort, and session restoration preferences', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-desktop-restore-'));
    const config = createDefaultPiwinConfig();
    config.desktop = {
      composerProfile: {
        model: {
          protocol: 'openai-compatible',
          providerId: 'cpa',
          modelId: 'deepseek-v4-flash',
        },
        thinkingLevel: 'high',
      },
    };
    config.desktop.lastSession = {
      sessionId: 'session-last-used',
      scope: { kind: 'project', projectPath: '/tmp/restored-project' },
    };

    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);

    expect(loaded.desktop?.composerProfile).toEqual(config.desktop.composerProfile);
    expect(loaded.desktop?.lastSession).toEqual(config.desktop.lastSession);
  });

  it('round-trips all capability-expansion config sections', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-config-expanded-'));
    const config = createDefaultPiwinConfig();
    config.process = {
      enabled: false,
      maxProcesses: 3,
      killOnSessionEnd: true,
      killOnHostDispose: false,
    };
    config.automation = { enabled: true, cronEnabled: true, hooksEnabled: false };
    config.marketplace = {
      skillSources: ['static', 'git-index'],
      mcpRegistrySources: ['static', 'official'],
    };

    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);

    expect(loaded.process).toEqual(config.process);
    expect(loaded.automation).toEqual(config.automation);
    expect(loaded.marketplace).toEqual(config.marketplace);
  });

  it('normalizes permissions.mode (default auto, unknown falls back)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-perm-config-'));
    const config = createDefaultPiwinConfig();
    config.permissions = { mode: 'bypass' };
    await savePiwinConfig(config, rootDir);
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.permissions).toEqual({ mode: 'bypass' });
  });

  it('falls back to auto when permissions.mode is missing or invalid', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-perm-config-invalid-'));
    const config = createDefaultPiwinConfig();
    config.permissions = { mode: 'bypass' };
    await savePiwinConfig(config, rootDir);
    // Corrupt the mode to confirm normalizeConfig rejects unknown values.
    const raw = await readFile(join(rootDir, 'config.json'), 'utf8');
    const corrupted = JSON.parse(raw);
    corrupted.permissions = { mode: 'yolo' };
    await writeFile(join(rootDir, 'config.json'), JSON.stringify(corrupted), 'utf8');
    const loaded = await loadPiwinConfig(rootDir);
    expect(loaded.permissions).toEqual({ mode: 'auto' });
  });
});
