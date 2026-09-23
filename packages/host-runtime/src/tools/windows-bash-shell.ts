import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export type ShellInvocation = {
  command: string;
  argv: string[];
};

const POWERSHELL_BOOTSTRAP = [
  '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);',
  'Remove-Item Alias:curl, Alias:wget, Alias:ls, Alias:cat -ErrorAction SilentlyContinue;',
].join(' ');

export function firstExisting(candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => candidate.length > 0 && existsSync(candidate));
}

export function findGitBash(): string | undefined {
  return firstExisting(gitBashCandidates()) ?? bashOnPath();
}

function gitBashCandidates(): string[] {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA ?? '';
  return [
    process.env.PIWIN_GIT_BASH ?? '',
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    localAppData ? join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe') : '',
  ];
}

function bashOnPath(): string | undefined {
  const pathEntries = (process.env.PATH ?? '').split(delimiter);
  return firstExisting(
    pathEntries
      .filter((entry) => entry.length > 0)
      .flatMap((entry) => [join(entry, 'bash.exe'), join(entry, 'bash')]),
  );
}

function powershellInvocation(command: string): ShellInvocation {
  const executable =
    process.env.PIWIN_POWERSHELL ??
    (process.env.SystemRoot
      ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe');
  return {
    command: executable,
    argv: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `${POWERSHELL_BOOTSTRAP} ${command}`,
    ],
  };
}

/** Shell the Windows bash tool actually runs. */
export type ResolvedWindowsShell = 'git-bash' | 'powershell';

/**
 * Which shell the bash tool resolves to right now. Always detected, never
 * remembered: a Git Bash that shows up later takes effect on the next launch
 * with no config change, and no stale choice can pin PowerShell forever.
 */
export function resolveWindowsShellKind(): ResolvedWindowsShell {
  return findGitBash() === undefined ? 'powershell' : 'git-bash';
}

/**
 * The tool is named bash. On Windows, Git for Windows supplies a real bash;
 * cmd.exe does not. PowerShell is only the last resort.
 */
export function resolveWindowsBashShell(command: string): ShellInvocation {
  const bash = findGitBash();
  if (bash) {
    return { command: bash, argv: ['-lc', command] };
  }
  return powershellInvocation(command);
}

/** Bash on Unix. Git Bash, then PATH bash, then PowerShell on Windows. */
export function resolveAgentShell(command: string): ShellInvocation {
  if (process.platform === 'win32') return resolveWindowsBashShell(command);
  return {
    command: process.env.SHELL ?? '/bin/bash',
    argv: ['-c', command],
  };
}
