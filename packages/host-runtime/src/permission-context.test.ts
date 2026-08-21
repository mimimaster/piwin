import { describe, expect, it } from 'vitest';
import { buildPermissionRequestContext } from './permission-context.js';

describe('buildPermissionRequestContext', () => {
  it('classifies bash command risk', () => {
    const context = buildPermissionRequestContext('bash', 'rm -rf /tmp/demo');
    expect(context.kind).toBe('command');
    expect(context.command).toContain('rm -rf');
    expect(context.destructive).toBe(true);
  });

  it('classifies secret file write', () => {
    const context = buildPermissionRequestContext('file-write', 'write /repo/.env');
    expect(context.kind).toBe('file-write');
    expect(context.secretRelated).toBe(true);
  });

  it('classifies network and mcp for remember scope', () => {
    expect(buildPermissionRequestContext('network:fetch', 'https://example.com/a').kind).toBe(
      'network',
    );
    expect(buildPermissionRequestContext('mcp:connect', 'server=docs').kind).toBe('mcp');
  });

  it('classifies explicit bash: action kind as command', () => {
    const context = buildPermissionRequestContext('bash:exec', 'rm -rf /tmp/demo');
    expect(context.kind).toBe('command');
    expect(context.command).toContain('rm -rf');
    expect(context.destructive).toBe(true);
  });

  it('does not label browser:lock as navigation', () => {
    const context = buildPermissionRequestContext('browser:lock', 'lock');
    expect(context.kind).toBe('network');
    expect(context.reason).toBe('Browser interaction requires review');
  });

  it('keeps navigate copy for browser:navigate', () => {
    const context = buildPermissionRequestContext('browser:navigate', 'https://example.com');
    expect(context.reason).toBe('Browser navigation requires review');
  });

  it('classifies explicit file-write: action kind as file-write', () => {
    const context = buildPermissionRequestContext('file-write:edit', 'write /repo/.env');
    expect(context.kind).toBe('file-write');
    expect(context.secretRelated).toBe(true);
  });
});
