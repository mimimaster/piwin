import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveAgentShell,
  resolveWindowsBashShell,
  resolveWindowsShellKind,
} from './windows-bash-shell.js';

const originalEnv = {
  PIWIN_GIT_BASH: process.env.PIWIN_GIT_BASH,
  PIWIN_POWERSHELL: process.env.PIWIN_POWERSHELL,
  PATH: process.env.PATH,
  ProgramFiles: process.env.ProgramFiles,
  'ProgramFiles(x86)': process.env['ProgramFiles(x86)'],
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  SystemRoot: process.env.SystemRoot,
};

async function restoreEnv(): Promise<void> {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('resolveWindowsBashShell', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await restoreEnv();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('prefers an explicit Git Bash over PATH and PowerShell', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-git-bash-'));
    tempDirs.push(root);
    const bash = join(root, 'bash.exe');
    await writeFile(bash, '');
    process.env.PIWIN_GIT_BASH = bash;
    process.env.PATH = '';
    process.env.ProgramFiles = root;
    process.env['ProgramFiles(x86)'] = root;
    process.env.LOCALAPPDATA = root;

    expect(resolveWindowsBashShell('git status')).toEqual({
      command: bash,
      argv: ['-lc', 'git status'],
    });
  });

  it('uses bash.exe discovered on PATH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-path-bash-'));
    tempDirs.push(root);
    const bin = join(root, 'bin');
    await mkdir(bin);
    const bash = join(bin, 'bash.exe');
    await writeFile(bash, '');
    delete process.env.PIWIN_GIT_BASH;
    process.env.ProgramFiles = root;
    process.env['ProgramFiles(x86)'] = root;
    process.env.LOCALAPPDATA = root;
    process.env.PATH = `${bin}${delimiter}${root}`;

    expect(resolveWindowsBashShell('ls')).toEqual({
      command: bash,
      argv: ['-lc', 'ls'],
    });
  });

  it('falls back to non-interactive PowerShell and clears POSIX aliases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-powershell-'));
    tempDirs.push(root);
    const powershell = join(root, 'powershell.exe');
    await writeFile(powershell, '');
    delete process.env.PIWIN_GIT_BASH;
    process.env.PIWIN_POWERSHELL = powershell;
    process.env.PATH = root;
    process.env.ProgramFiles = root;
    process.env['ProgramFiles(x86)'] = root;
    process.env.LOCALAPPDATA = root;

    const invocation = resolveWindowsBashShell('git status');
    expect(invocation.command).toBe(powershell);
    expect(invocation.argv.slice(0, 5)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
    ]);
    expect(invocation.argv[5]).toContain('Alias:curl');
    expect(invocation.argv[5]).toContain('git status');
  });
});

  it('keeps the user shell on Unix', () => {
    if (process.platform === 'win32') return;
    process.env.SHELL = '/bin/zsh';
    expect(resolveAgentShell('printf ok')).toEqual({
      command: '/bin/zsh',
      argv: ['-c', 'printf ok'],
    });
  });

describe('shell detection', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await restoreEnv();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  /** Git Bash that exists on disk, so detection succeeds. */
  async function installedGitBash(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'piwin-detect-bash-'));
    tempDirs.push(root);
    const bash = join(root, 'bash.exe');
    await writeFile(bash, '');
    process.env.PIWIN_GIT_BASH = bash;
    process.env.PATH = '';
    process.env.ProgramFiles = root;
    process.env['ProgramFiles(x86)'] = root;
    process.env.LOCALAPPDATA = root;
    return bash;
  }

  async function noGitBash(): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'piwin-detect-none-'));
    tempDirs.push(root);
    delete process.env.PIWIN_GIT_BASH;
    process.env.PATH = root;
    process.env.ProgramFiles = root;
    process.env['ProgramFiles(x86)'] = root;
    process.env.LOCALAPPDATA = root;
  }

  it('picks up a Git Bash that was not there before, with no config change', async () => {
    await noGitBash();
    expect(resolveWindowsShellKind()).toBe('powershell');

    const bash = await installedGitBash();
    expect(resolveWindowsShellKind()).toBe('git-bash');
    expect(resolveWindowsBashShell('ls')).toEqual({ command: bash, argv: ['-lc', 'ls'] });
  });
});
