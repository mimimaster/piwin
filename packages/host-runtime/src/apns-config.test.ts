import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { isApnsConfigured, readApnsConfig } from './apns-config.js';

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'piwin-apns-'));
}

describe('readApnsConfig', () => {
  it('returns null when the file is missing', () => {
    const root = tempRoot();
    expect(readApnsConfig(root)).toBeNull();
    expect(isApnsConfigured(root)).toBe(false);
  });

  it('returns null when required fields are empty (fill-later template)', () => {
    const root = tempRoot();
    writeFileSync(
      join(root, 'apns.json'),
      JSON.stringify({
        keyId: '',
        teamId: '',
        bundleId: '',
        keyPath: '',
        environment: 'sandbox',
      }),
    );
    expect(readApnsConfig(root)).toBeNull();
  });

  it('returns config when all fields are filled and does not embed key bytes', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'apns'), { recursive: true });
    const keyPath = join(root, 'apns', 'AuthKey_TEST.p8');
    writeFileSync(keyPath, '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\n');
    writeFileSync(
      join(root, 'apns.json'),
      JSON.stringify({
        keyId: 'ABC123',
        teamId: 'TEAMID1',
        bundleId: 'app.piwin.mobile',
        keyPath,
        environment: 'sandbox',
      }),
    );
    const config = readApnsConfig(root);
    expect(config).toEqual({
      keyId: 'ABC123',
      teamId: 'TEAMID1',
      bundleId: 'app.piwin.mobile',
      keyPath,
      environment: 'sandbox',
    });
    expect(JSON.stringify(config)).not.toContain('BEGIN PRIVATE KEY');
    expect(JSON.stringify(config)).not.toContain('SECRET');
  });
});
