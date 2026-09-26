import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { getPiwinRoot } from '../paths.js';

export type ShellInvocation = {
  command: string;
  argv: string[];
};

const POWERSHELL_BOOTSTRAP = [
  '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);',
  'Remove-Item Alias:curl, Alias:wget, Alias:ls, Alias:cat -ErrorAction SilentlyContinue;',
].join(' ');

const GIT_BASH_PROBE = 'printf "PIWIN_GIT_BASH:%s" "$MSYSTEM"';
const GIT_BASH_MARKER = 'PIWIN_GIT_BASH:MINGW';
const validatedPaths = new Map<string, string>();

function cachePath(piwinRoot?: string): string {
  return join(getPiwinRoot(piwinRoot), 'cache', 'windows-git-bash.json');
}

function readCachedPath(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof value === 'object' && value !== null && 'path' in value &&
        typeof value.path === 'string') {
      return value.path;
    }
  } catch (error) {
    console.warn('Could not read the cached Git Bash path:', error);
  }
  clearCachedPath(path);
  return undefined;
}

function saveCachedPath(path: string, bash: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify({ path: bash })}\n`, 'utf8');
    renameSync(temporary, path);
  } catch (error) {
    console.warn('Could not cache the Git Bash path:', error);
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file was never created or has already been renamed.
    }
  }
}

function clearCachedPath(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('Could not remove a stale Git Bash path:', error);
    }
  }
}

function isGitBashWrapper(candidate: string): boolean {
  if (!existsSync(candidate)) return false;
  const normalized = resolve(candidate);
  const lowered = normalized.toLowerCase();
  if (lowered.includes('\\windows\\system32\\') ||
      lowered.includes('\\microsoft\\windowsapps\\')) return false;
  const bin = dirname(normalized);
  return basename(lowered) === 'bash.exe' &&
    basename(bin).toLowerCase() === 'bin' &&
    existsSync(join(dirname(bin), 'cmd', 'git.exe'));
}

function probeGitBash(candidate: string): boolean {
  if (!isGitBashWrapper(candidate)) return false;
  const result = spawnSync(candidate, ['-lc', GIT_BASH_PROBE], {
    encoding: 'utf8',
    timeout: 3_000,
    windowsHide: true,
    maxBuffer: 64 * 1024,
  });
  return result.status === 0 && result.stdout.includes(GIT_BASH_MARKER);
}

function registryInstallRoots(): string[] {
  const roots: string[] = [];
  const reg = process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'reg.exe')
    : 'reg.exe';
  for (const hive of ['HKCU', 'HKLM']) {
    const result = spawnSync(reg, ['query', `${hive}\\Software\\GitForWindows`, '/v', 'InstallPath'], {
      encoding: 'utf8', timeout: 1_000, windowsHide: true,
    });
    if (result.status !== 0) continue;
    const match = /^\s*InstallPath\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/im.exec(result.stdout);
    if (match?.[1]) roots.push(match[1]);
  }
  return roots;
}

function gitBashCandidates(): string[] {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const installed = [
    ...registryInstallRoots(),
    join(programFiles, 'Git'),
    join(programFilesX86, 'Git'),
    ...(localAppData ? [join(localAppData, 'Programs', 'Git')] : []),
  ];
  for (const entry of pathEntries) {
    if (existsSync(join(entry, 'git.exe'))) installed.push(dirname(entry));
  }
  return [
    ...installed.map((root) => join(root, 'bin', 'bash.exe')),
    ...pathEntries.map((entry) => join(entry, 'bash.exe')),
  ];
}

/** The Windows Host remembers only a verified path, never a false "installed" flag. */
export function findGitBash(piwinRoot?: string): string | undefined {
  const cache = cachePath(piwinRoot);
  const override = process.env.PIWIN_GIT_BASH?.trim();
  const remembered = validatedPaths.get(cache) ?? readCachedPath(cache);
  const seen = new Set<string>();
  function check(candidate: string | undefined): string | undefined {
    if (!candidate) return undefined;
    const normalized = resolve(candidate);
    const key = normalized.toLowerCase();
    if (seen.has(key)) return undefined;
    seen.add(key);
    if (validatedPaths.get(cache) === normalized && isGitBashWrapper(normalized)) {
      return normalized;
    }
    if (!probeGitBash(normalized)) return undefined;
    validatedPaths.set(cache, normalized);
    if (remembered !== normalized) saveCachedPath(cache, normalized);
    return normalized;
  }
  const reusable = check(override) ?? check(remembered);
  if (reusable) return reusable;
  for (const candidate of gitBashCandidates()) {
    const found = check(candidate);
    if (found) return found;
  }
  validatedPaths.delete(cache);
  if (remembered) clearCachedPath(cache);
  return undefined;
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

export function resolveWindowsShellKind(piwinRoot?: string): ResolvedWindowsShell {
  return findGitBash(piwinRoot) === undefined ? 'powershell' : 'git-bash';
}

export function resolveWindowsBashShell(command: string, piwinRoot?: string): ShellInvocation {
  const bash = findGitBash(piwinRoot);
  if (bash) return { command: bash, argv: ['-lc', command] };
  return powershellInvocation(command);
}

/** Unix shell resolution remains unchanged. */
export function resolveAgentShell(command: string, piwinRoot?: string): ShellInvocation {
  if (process.platform === 'win32') return resolveWindowsBashShell(command, piwinRoot);
  return {
    command: process.env.SHELL ?? '/bin/bash',
    argv: ['-c', command],
  };
}
