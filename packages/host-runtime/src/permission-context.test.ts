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

  it('states privilege and TUI limits for extension install', () => {
    const context = buildPermissionRequestContext(
      'extensions:install',
      'extensions:install https://github.com/example/ext',
    );
    expect(context.kind).toBe('unknown');
    expect(context.summary).toBe('Install a Pi extension');
    expect(context.reason).toMatch(/OS privileges/);
    expect(context.reason).toMatch(/\/reload/);
  });

  it('classifies explicit file-write: action kind as file-write', () => {
    const context = buildPermissionRequestContext('file-write:edit', 'write /repo/.env');
    expect(context.kind).toBe('file-write');
    expect(context.secretRelated).toBe(true);
  });

  it('shows the outside path and boundary reason for a file write', () => {
    const context = buildPermissionRequestContext('file-write', '/other/report.txt', {
      policyReason: 'path-escapes-project-root',
    });
    expect(context).toMatchObject({
      kind: 'file-write',
      outsideWorkspace: true,
      paths: ['/other/report.txt'],
    });
    expect(context.reason).toContain('outside the session workspace');
  });

  it('shows the requested directory and command for a Job boundary prompt', () => {
    const context = buildPermissionRequestContext(
      'process:start',
      'cwd-outside-workspace: /other\n$ pnpm dev',
      { policyReason: 'cwd-outside-workspace', cwd: '/other', command: 'pnpm dev' },
    );
    expect(context).toMatchObject({
      kind: 'command',
      outsideWorkspace: true,
      cwd: '/other',
      command: 'pnpm dev',
    });
  });

  it('lists every browser upload path, including names with spaces', () => {
    const paths = ['/repo/one.txt', '/other/two words.txt'];
    const context = buildPermissionRequestContext('browser:upload', paths.join('\n'), {
      policyReason: 'path-escapes-project-root',
      paths,
    });
    expect(context).toMatchObject({ kind: 'file-write', outsideWorkspace: true, paths });
    expect(context.reason).toContain('sent to the browser page');
  });
});
