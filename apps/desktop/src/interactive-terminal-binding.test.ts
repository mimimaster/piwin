import { describe, expect, it } from 'vitest';
import {
  isDesktopTerminalFilesystemPath,
  resolveInteractiveTerminalCwd,
  resolveInteractiveTerminalProjectPath,
} from './interactive-terminal-binding.js';

describe('interactive terminal binding', () => {
  it('rejects opaque remote project ids as cwd or project roots', () => {
    const remoteProjectId = 'project-0123456789abcdef01234567';
    expect(isDesktopTerminalFilesystemPath(remoteProjectId)).toBe(false);
    expect(resolveInteractiveTerminalProjectPath(remoteProjectId)).toBeNull();
    expect(
      resolveInteractiveTerminalCwd({
        preferredCwd: remoteProjectId,
        projectPath: remoteProjectId,
      }),
    ).toBe('');
  });

  it('keeps real filesystem paths, including Windows roots', () => {
    expect(isDesktopTerminalFilesystemPath('/Users/demo/src')).toBe(true);
    expect(isDesktopTerminalFilesystemPath('~/Developer')).toBe(true);
    expect(isDesktopTerminalFilesystemPath('C:\\work\\piwin')).toBe(true);
    expect(resolveInteractiveTerminalProjectPath('/Users/demo/src')).toBe(
      '/Users/demo/src',
    );
    expect(
      resolveInteractiveTerminalCwd({
        preferredCwd: '',
        projectPath: '/Users/demo/src',
      }),
    ).toBe('/Users/demo/src');
  });

  it('prefers an explicit filesystem cwd over the project root', () => {
    expect(
      resolveInteractiveTerminalCwd({
        preferredCwd: '/tmp/scratch',
        projectPath: '/Users/demo/src',
      }),
    ).toBe('/tmp/scratch');
  });
});
