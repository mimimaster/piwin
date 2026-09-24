import { describe, expect, it } from 'vitest';
import type { PermissionRequestContext } from '@piwin/contracts';
import { canRememberPermissionForProject } from './permission-request-card';

describe('canRememberPermissionForProject', () => {
  it('returns true for network context kind', () => {
    const context: PermissionRequestContext = {
      kind: 'network',
      summary: 'fetch https://example.com',
      host: 'example.com',
    };
    expect(canRememberPermissionForProject(context, 'network:fetch')).toBe(true);
  });

  it('returns true for command context kind', () => {
    const context: PermissionRequestContext = {
      kind: 'command',
      summary: 'bash: rm -rf build',
      command: 'rm -rf build',
    };
    expect(canRememberPermissionForProject(context, 'bash:rm -rf build')).toBe(true);
    expect(canRememberPermissionForProject(context, 'process:start')).toBe(false);
    expect(canRememberPermissionForProject(context, 'browser:upload')).toBe(false);
  });

  it('returns true for file-write context kind', () => {
    const context: PermissionRequestContext = {
      kind: 'file-write',
      summary: 'write /tmp/scratch.txt',
      paths: ['/tmp/scratch.txt'],
    };
    expect(canRememberPermissionForProject(context, 'file-write:/tmp/scratch.txt')).toBe(true);
  });

  it('returns false for git context kind', () => {
    const context: PermissionRequestContext = {
      kind: 'git',
      summary: 'git push',
      command: 'git push',
    };
    expect(canRememberPermissionForProject(context, 'git:push')).toBe(false);
  });

  it('returns false for mcp context kind', () => {
    const context: PermissionRequestContext = {
      kind: 'mcp',
      summary: 'mcp tool call',
      serverId: 'fs',
    };
    expect(canRememberPermissionForProject(context, 'mcp:fs.read')).toBe(false);
  });

  it('returns false for unknown context kind', () => {
    const context: PermissionRequestContext = {
      kind: 'unknown',
      summary: 'something',
    };
    expect(canRememberPermissionForProject(context, 'unknown')).toBe(false);
  });

  it('falls back to action prefix when context is null', () => {
    expect(canRememberPermissionForProject(null, 'network:fetch')).toBe(true);
    expect(canRememberPermissionForProject(null, 'bash:ls')).toBe(false);
  });

  it('falls back to action prefix when context is undefined', () => {
    expect(canRememberPermissionForProject(undefined, 'network:fetch')).toBe(true);
    expect(canRememberPermissionForProject(undefined, 'file-write:/x')).toBe(false);
  });
});
