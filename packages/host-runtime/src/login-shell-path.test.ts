import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LOGIN_SHELL_PATH_TIMEOUT_MS,
  ensureLoginShellPath,
  mergePathEntries,
  parsePathEntries,
  resetLoginShellPathForTests,
  resolveLoginShellPath,
} from './login-shell-path.js';

const originalPath = process.env.PATH;

/** What a real `-ilc` run prints: the framed PATH, possibly after rc noise. */
function framed(path: string, noise = ''): string {
  return `${noise}__PIWIN_PATH_START__${path}__PIWIN_PATH_END__`;
}

afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.PIWIN_SKIP_LOGIN_SHELL_PATH;
  resetLoginShellPathForTests();
});

describe('mergePathEntries', () => {
  it('puts login-shell entries first and keeps every existing entry', () => {
    const merged = mergePathEntries('/usr/bin:/bin', ['/fnm/node/bin', '/usr/bin']);
    expect(merged.path).toBe('/fnm/node/bin:/usr/bin:/bin');
    expect(merged.addedEntryCount).toBe(1);
  });

  it('reports no additions when the current PATH already covers the shell', () => {
    const merged = mergePathEntries('/fnm/node/bin:/usr/bin', ['/fnm/node/bin']);
    expect(merged.path).toBe('/fnm/node/bin:/usr/bin');
    expect(merged.addedEntryCount).toBe(0);
  });

  it('survives an unset current PATH and drops empty entries', () => {
    expect(mergePathEntries(undefined, ['/fnm/node/bin', '']).path).toBe('/fnm/node/bin');
    expect(parsePathEntries(undefined)).toEqual([]);
    expect(parsePathEntries('/a::/b')).toEqual(['/a', '/b']);
  });
});

describe('resolveLoginShellPath', () => {
  it('queries the login shell and prefers its entries', async () => {
    const runShell = vi.fn(async () => framed('/home/u/.fnm/node/bin'));
    const resolved = await resolveLoginShellPath({
      env: { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh', NODE_ENV: 'production' } as NodeJS.ProcessEnv,
      runShell,
    });
    expect(resolved.source).toBe('login-shell');
    expect(resolved.path).toBe('/home/u/.fnm/node/bin:/usr/bin:/bin');
    expect(resolved.addedEntryCount).toBe(1);
    expect(runShell).toHaveBeenCalledWith(
      expect.objectContaining({
        shell: '/bin/zsh',
        args: ['-ilc', expect.stringContaining('"$PATH"')],
        timeoutMs: LOGIN_SHELL_PATH_TIMEOUT_MS,
      }),
    );
  });

  it('ignores what interactive rc files print around the PATH', async () => {
    const resolved = await resolveLoginShellPath({
      env: { PATH: '/usr/bin', SHELL: '/bin/zsh', NODE_ENV: 'production' } as NodeJS.ProcessEnv,
      runShell: async () =>
        framed('/home/u/.fnm/node/bin:/usr/bin', 'Welcome back!\nUsing Node v24.1.0\n'),
    });
    expect(resolved.path).toBe('/home/u/.fnm/node/bin:/usr/bin');
  });

  it('keeps the current PATH when the shell cannot be queried', async () => {
    const resolved = await resolveLoginShellPath({
      env: { PATH: '/usr/bin', SHELL: '/bin/zsh', NODE_ENV: 'production' } as NodeJS.ProcessEnv,
      runShell: async () => {
        throw new Error('spawn ENOENT');
      },
    });
    expect(resolved.source).toBe('unavailable');
    expect(resolved.path).toBe('/usr/bin');
    expect(resolved.reason).toContain('ENOENT');
  });

  it('keeps the current PATH when the shell reports nothing', async () => {
    const resolved = await resolveLoginShellPath({
      env: { PATH: '/usr/bin', NODE_ENV: 'production' } as NodeJS.ProcessEnv,
      runShell: async () => '\n',
    });
    expect(resolved.source).toBe('unavailable');
    expect(resolved.path).toBe('/usr/bin');
  });

  it('falls back to /bin/sh when SHELL is unset', async () => {
    const runShell = vi.fn(async () => framed('/fnm/bin'));
    await resolveLoginShellPath({
      env: { PATH: '/usr/bin', NODE_ENV: 'production' } as NodeJS.ProcessEnv,
      runShell,
    });
    expect(runShell).toHaveBeenCalledWith(expect.objectContaining({ shell: '/bin/sh' }));
  });

  it('skips Windows, tests and the explicit opt-out', async () => {
    const runShell = vi.fn(async () => framed('/fnm/bin'));
    await expect(
      resolveLoginShellPath({ env: {} as NodeJS.ProcessEnv, platform: 'win32', runShell }),
    ).resolves.toMatchObject({ source: 'skipped' });
    await expect(
      resolveLoginShellPath({
        env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv,
        platform: 'darwin',
        runShell,
      }),
    ).resolves.toMatchObject({ source: 'skipped' });
    await expect(
      resolveLoginShellPath({
        env: { PATH: '/usr/bin', PIWIN_SKIP_LOGIN_SHELL_PATH: '1' } as NodeJS.ProcessEnv,
        platform: 'darwin',
        runShell,
      }),
    ).resolves.toMatchObject({ source: 'skipped' });
    expect(runShell).not.toHaveBeenCalled();
  });
});

describe('ensureLoginShellPath', () => {
  it('resolves once and writes the merged PATH into the process environment', async () => {
    const runShell = vi.fn(async () => framed('/fnm/node/bin'));
    const env = { PATH: '/usr/bin', SHELL: '/bin/zsh' } as NodeJS.ProcessEnv;
    const first = await ensureLoginShellPath({ env, runShell });
    const second = await ensureLoginShellPath({ env, runShell });
    expect(first.source).toBe('login-shell');
    expect(second).toBe(first);
    expect(runShell).toHaveBeenCalledTimes(1);
    expect(process.env.PATH).toBe('/fnm/node/bin:/usr/bin');
  });
});
