import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { windowsShellPrompt } from './windows-shell-prompt.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn((command: string) => command.toLowerCase().endsWith('reg.exe')
    ? { status: 1, stdout: '' }
    : { status: 0, stdout: 'PIWIN_GIT_BASH:MINGW64' }),
}));

describe('windowsShellPrompt', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  const ENV_KEYS = [
    'PIWIN_GIT_BASH',
    'PIWIN_ROOT',
    'PATH',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'LOCALAPPDATA',
  ] as const;
  const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  /**
   * The platform guard is invisible on a POSIX dev machine otherwise: `/bin/bash`
   * exists, so detection would report Git Bash and the note would stay silent
   * for the wrong reason. Tests assert it by faking the platform.
   */
  function stubPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }

  /** Point every detection location at an empty dir, so no bash is found. */
  async function hideGitBash(): Promise<string> {
    const empty = await mkdtemp(join(tmpdir(), 'piwin-no-bash-env-'));
    process.env.PIWIN_ROOT = join(empty, 'state');
    delete process.env.PIWIN_GIT_BASH;
    process.env.PATH = empty;
    process.env.ProgramFiles = empty;
    process.env['ProgramFiles(x86)'] = empty;
    process.env.LOCALAPPDATA = empty;
    return empty;
  }

  it('names PowerShell exactly when the bash tool resolves to PowerShell', async () => {
    const empty = await hideGitBash();
    try {
      stubPlatform('win32');

      // The note follows detection, so it can never describe a shell other than
      // the one the invocation runs.
      expect(windowsShellPrompt()).toContain('Windows PowerShell');
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('stays silent when Git Bash is the resolved shell or off Windows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-git-bash-env-'));
    const bash = join(root, 'Git', 'bin', 'bash.exe');
    await mkdir(join(root, 'Git', 'bin'), { recursive: true });
    await mkdir(join(root, 'Git', 'cmd'), { recursive: true });
    await writeFile(join(root, 'Git', 'cmd', 'git.exe'), '');
    await writeFile(bash, '');
    try {
      stubPlatform('win32');
      process.env.PIWIN_ROOT = join(root, 'state');
      process.env.PIWIN_GIT_BASH = bash;
      expect(windowsShellPrompt()).toBeUndefined();

      stubPlatform('darwin');
      expect(windowsShellPrompt()).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
