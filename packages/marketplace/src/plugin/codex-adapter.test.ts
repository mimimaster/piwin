import { describe, expect, it } from 'vitest';
import { adaptCodexManifest } from './codex-adapter.js';

describe('adaptCodexManifest', () => {
  it('maps a full Codex manifest', () => {
    const result = adaptCodexManifest({
      id: 'remotion',
      version: '1.2.0',
      name: 'Remotion',
      description: 'Video generation',
      skills: ['skills/remotion'],
      mcpServers: {
        'remotion-server': {
          command: 'npx',
          args: ['-y', '@remotion/server'],
          env: { ELEVENLABS_API_KEY: '${ELEVENLABS_API_KEY}' },
        },
      },
      secrets: [
        { name: 'ELEVENLABS_API_KEY', required: true },
      ],
      connectors: { foo: {} },
      hooks: { onInstall: 'script.sh' },
    });

    expect(result.manifest.id).toBe('remotion');
    expect(result.manifest.skills).toEqual(['skills/remotion']);
    expect(result.manifest.mcpServers?.['remotion-server']?.command).toBe('npx');
    expect(result.manifest.secrets?.[0]?.name).toBe('ELEVENLABS_API_KEY');
    expect(result.warnings).toContain('Dropped Codex-only key "connectors" (not supported by piwin)');
    expect(result.warnings).toContain('Dropped Codex-only key "hooks" (not supported by piwin)');
  });

  it('maps minimal manifest', () => {
    const result = adaptCodexManifest({
      id: 'minimal',
      version: '0.1.0',
      name: 'Minimal',
    });
    expect(result.manifest.id).toBe('minimal');
    expect(result.warnings).toEqual([]);
  });

  it('lowercases id', () => {
    const result = adaptCodexManifest({
      id: 'MyPlugin',
      version: '1.0.0',
      name: 'X',
    });
    expect(result.manifest.id).toBe('myplugin');
  });

  it('maps "env" array as secrets', () => {
    const result = adaptCodexManifest({
      id: 'p',
      version: '1.0.0',
      name: 'X',
      env: [{ key: 'api_key', required: true }],
    });
    expect(result.manifest.secrets?.[0]?.name).toBe('API_KEY');
    expect(result.manifest.secrets?.[0]?.required).toBe(true);
  });

  it('skips invalid MCP servers with warning', () => {
    const result = adaptCodexManifest({
      id: 'p',
      version: '1.0.0',
      name: 'X',
      mcpServers: {
        bad: { args: ['x'] },
      },
    });
    expect(result.manifest.mcpServers).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('bad'))).toBe(true);
  });

  it('throws on missing required fields', () => {
    expect(() => adaptCodexManifest({ id: 'x' })).toThrow();
  });
});
