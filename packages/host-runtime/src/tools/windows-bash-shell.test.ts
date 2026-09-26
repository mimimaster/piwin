import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  findGitBash,
  resolveAgentShell,
  resolveWindowsBashShell,
  resolveWindowsShellKind,
} from './windows-bash-shell.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn((command: string) => command.toLowerCase().endsWith('reg.exe')
    ? { status: 1, stdout: '' }
    : { status: 0, stdout: 'PIWIN_GIT_BASH:MINGW64' }),
}));

const ENV_KEYS = [
  'PIWIN_GIT_BASH', 'PIWIN_POWERSHELL', 'PIWIN_ROOT', 'PATH',
  'ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA', 'SystemRoot', 'SHELL',
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const tempDirs: string[] = [];

async function setup(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-windows-shell-'));
  tempDirs.push(root);
  process.env.PIWIN_ROOT = join(root, 'state');
  process.env.ProgramFiles = join(root, 'not-installed');
  process.env['ProgramFiles(x86)'] = join(root, 'not-installed');
  process.env.LOCALAPPDATA = join(root, 'not-installed');
  process.env.PATH = '';
  delete process.env.PIWIN_GIT_BASH;
  return root;
}

async function gitBash(root: string, name = 'Git'): Promise<string> {
  const installed = join(root, name);
  const bash = join(installed, 'bin', 'bash.exe');
  await mkdir(join(installed, 'bin'), { recursive: true });
  await mkdir(join(installed, 'cmd'), { recursive: true });
  await writeFile(join(installed, 'cmd', 'git.exe'), '');
  await writeFile(bash, '');
  return bash;
}

afterEach(async () => {
  vi.mocked(spawnSync).mockReset();
  vi.mocked(spawnSync).mockImplementation((command) => ({
    status: String(command).toLowerCase().endsWith('reg.exe') ? 1 : 0,
    stdout: String(command).toLowerCase().endsWith('reg.exe') ? '' : 'PIWIN_GIT_BASH:MINGW64',
  }) as ReturnType<typeof spawnSync>);
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Windows Git Bash discovery', () => {
  it('prefers a verified explicit path and persists it', async () => {
    const root = await setup();
    const bash = await gitBash(root);
    process.env.PIWIN_GIT_BASH = bash;

    expect(resolveWindowsBashShell('git status')).toEqual({
      command: bash, argv: ['-lc', 'git status'],
    });
    const cached = JSON.parse(await readFile(join(process.env.PIWIN_ROOT ?? '', 'cache', 'windows-git-bash.json'), 'utf8')) as { path: string };
    expect(cached.path).toBe(bash);

    delete process.env.PIWIN_GIT_BASH;
    vi.mocked(spawnSync).mockClear();
    expect(findGitBash()).toBe(bash);
    expect(spawnSync).not.toHaveBeenCalled();

    vi.resetModules();
    const restarted = await import('./windows-bash-shell.js');
    expect(restarted.findGitBash()).toBe(bash);
    expect(spawnSync).toHaveBeenCalledWith(bash, expect.anything(), expect.anything());
    expect(vi.mocked(spawnSync).mock.calls.some(([command]) => String(command).toLowerCase().endsWith('reg.exe'))).toBe(false);
  });

  it('continues past a WSL launcher to a later Git Bash on PATH', async () => {
    const root = await setup();
    const systemBin = join(root, 'System32');
    const bash = await gitBash(root);
    await mkdir(systemBin);
    await writeFile(join(systemBin, 'bash.exe'), '');
    process.env.PATH = `${systemBin}${delimiter}${join(root, 'Git', 'bin')}`;

    expect(resolveWindowsBashShell('printf ok').command).toBe(bash);
    expect(spawnSync).not.toHaveBeenCalledWith(join(systemBin, 'bash.exe'), expect.anything(), expect.anything());
  });

  it('finds a non-default install through Git on PATH', async () => {
    const root = await setup();
    const bash = await gitBash(root, 'D-drive-Git');
    process.env.PATH = join(root, 'D-drive-Git', 'cmd');
    expect(findGitBash()).toBe(bash);
  });

  it('finds a non-default install recorded by Git for Windows', async () => {
    const root = await setup();
    const bash = await gitBash(root, 'D-drive-Git');
    const installRoot = join(root, 'D-drive-Git');
    vi.mocked(spawnSync).mockImplementation((command) => ({
      status: 0,
      stdout: String(command).toLowerCase().endsWith('reg.exe')
        ? `    InstallPath    REG_SZ    ${installRoot}\r\n`
        : 'PIWIN_GIT_BASH:MINGW64',
    }) as ReturnType<typeof spawnSync>);

    expect(findGitBash()).toBe(bash);
  });

  it('skips a candidate that exists but cannot run, then tries the next', async () => {
    const root = await setup();
    const broken = await gitBash(root, 'Broken');
    const working = await gitBash(root, 'Working');
    process.env.PIWIN_GIT_BASH = broken;
    process.env.PATH = join(root, 'Working', 'bin');
    vi.mocked(spawnSync).mockImplementation((command) => ({
      status: command === broken || String(command).toLowerCase().endsWith('reg.exe') ? 1 : 0,
      stdout: command === working ? 'PIWIN_GIT_BASH:MINGW64' : '',
    }) as ReturnType<typeof spawnSync>);

    expect(findGitBash()).toBe(working);
  });

  it('rechecks a missing remembered path and discovers a replacement', async () => {
    const root = await setup();
    const first = await gitBash(root, 'First');
    process.env.PIWIN_GIT_BASH = first;
    expect(findGitBash()).toBe(first);
    await unlink(first);
    delete process.env.PIWIN_GIT_BASH;

    const second = await gitBash(root, 'Second');
    process.env.PATH = join(root, 'Second', 'bin');
    expect(findGitBash()).toBe(second);
    const cached = JSON.parse(await readFile(join(process.env.PIWIN_ROOT ?? '', 'cache', 'windows-git-bash.json'), 'utf8')) as { path: string };
    expect(cached.path).toBe(second);
  });

  it('falls back to PowerShell when no verified Git Bash exists', async () => {
    const root = await setup();
    process.env.PIWIN_POWERSHELL = join(root, 'powershell.exe');
    expect(resolveWindowsShellKind()).toBe('powershell');
    const invocation = resolveWindowsBashShell('git status');
    expect(invocation.command).toBe(process.env.PIWIN_POWERSHELL);
    expect(invocation.argv.slice(0, 5)).toEqual([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    ]);
    expect(invocation.argv[5]).toContain('git status');
  });

  it('leaves Unix shell behavior alone', async () => {
    await setup();
    if (process.platform === 'win32') return;
    process.env.SHELL = '/bin/zsh';
    expect(resolveAgentShell('printf ok')).toEqual({
      command: '/bin/zsh', argv: ['-c', 'printf ok'],
    });
  });
});
