import { describe, expect, it } from 'vitest';
import { parsePluginManifest, tryValidatePluginManifest } from './manifest.js';

const VALID_MANIFEST = {
  id: 'my-plugin',
  version: '1.0.0',
  name: 'My Plugin',
  description: 'A test plugin',
  skills: ['skills/foo'],
  mcpServers: {
    'my-server': {
      command: 'npx',
      args: ['-y', '@example/server'],
      env: { API_KEY: '${API_KEY}' },
    },
  },
  secrets: [
    {
      name: 'API_KEY',
      displayName: 'API Key',
      description: 'Your API key',
      required: true,
    },
  ],
};

describe('tryValidatePluginManifest', () => {
  it('accepts a valid full manifest', () => {
    const result = tryValidatePluginManifest(VALID_MANIFEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe('my-plugin');
      expect(result.manifest.skills).toEqual(['skills/foo']);
      expect(result.manifest.mcpServers?.['my-server']?.command).toBe('npx');
      expect(result.manifest.secrets?.[0]?.name).toBe('API_KEY');
    }
  });

  it('accepts a minimal manifest (id + version + name only)', () => {
    const result = tryValidatePluginManifest({
      id: 'minimal',
      version: '0.1.0',
      name: 'Minimal',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects non-object', () => {
    const result = tryValidatePluginManifest('not an object');
    expect(result.ok).toBe(false);
  });

  it('rejects missing id', () => {
    const result = tryValidatePluginManifest({ version: '1.0.0', name: 'X' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === 'id')).toBe(true);
    }
  });

  it('rejects bad id (uppercase)', () => {
    const result = tryValidatePluginManifest({ id: 'MyPlugin', version: '1.0.0', name: 'X' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === 'id')).toBe(true);
    }
  });

  it('rejects unknown top-level key', () => {
    const result = tryValidatePluginManifest({
      id: 'p',
      version: '1.0.0',
      name: 'X',
      hooks: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === 'hooks')).toBe(true);
    }
  });

  it('rejects ".." in skill path', () => {
    const result = tryValidatePluginManifest({
      id: 'p',
      version: '1.0.0',
      name: 'X',
      skills: ['../etc/passwd'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === 'skills[0]')).toBe(true);
    }
  });

  it('rejects absolute skill path', () => {
    const result = tryValidatePluginManifest({
      id: 'p',
      version: '1.0.0',
      name: 'X',
      skills: ['/abs/path'],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects bad secret name (lowercase)', () => {
    const result = tryValidatePluginManifest({
      id: 'p',
      version: '1.0.0',
      name: 'X',
      secrets: [{ name: 'api_key' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === 'secrets[0].name')).toBe(true);
    }
  });

  it('rejects unknown key in mcpServer', () => {
    const result = tryValidatePluginManifest({
      id: 'p',
      version: '1.0.0',
      name: 'X',
      mcpServers: {
        srv: { command: 'npx', url: 'bad' },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === 'mcpServers.srv.url')).toBe(true);
    }
  });

  it('rejects missing command in mcpServer', () => {
    const result = tryValidatePluginManifest({
      id: 'p',
      version: '1.0.0',
      name: 'X',
      mcpServers: { srv: { args: ['x'] } },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects bad server id', () => {
    const result = tryValidatePluginManifest({
      id: 'p',
      version: '1.0.0',
      name: 'X',
      mcpServers: { 'bad id!': { command: 'npx' } },
    });
    expect(result.ok).toBe(false);
  });
});

describe('parsePluginManifest', () => {
  it('returns manifest on valid input', () => {
    const manifest = parsePluginManifest(VALID_MANIFEST);
    expect(manifest.id).toBe('my-plugin');
  });

  it('throws on invalid input', () => {
    expect(() => parsePluginManifest({ id: 'BAD', version: '', name: '' })).toThrow();
  });
});
