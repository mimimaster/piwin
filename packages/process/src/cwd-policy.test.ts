import { describe, expect, it } from 'vitest';
import { isPathInsideRoot, resolveTrustedCwd } from './cwd-policy.js';

describe('cwd policy', () => {
  it('accepts cwd equal to trusted root', () => {
    const result = resolveTrustedCwd('/tmp/proj', ['/tmp/proj']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.absoluteCwd).toBe(result.projectRoot);
    }
  });

  it('accepts cwd under trusted root', () => {
    const result = resolveTrustedCwd('/tmp/proj/apps', ['/tmp/proj']);
    expect(result.ok).toBe(true);
  });

  it('rejects cwd outside trusted roots', () => {
    const result = resolveTrustedCwd('/tmp/other', ['/tmp/proj']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/outside trusted/);
    }
  });

  it('rejects path escape via ..', () => {
    expect(isPathInsideRoot('/tmp/proj/../evil', '/tmp/proj')).toBe(false);
  });

  it('rejects empty trusted list', () => {
    const result = resolveTrustedCwd('/tmp/proj', []);
    expect(result.ok).toBe(false);
  });
});
