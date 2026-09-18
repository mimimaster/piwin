/**
 * First-use Playwright Chromium install into the Host cache.
 * Chromium is not bundled in the Desktop app (ADR 0020).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { AbortOperationError, BrowserUnavailableError } from './browser-errors.js';
import { getBrowserInstallStatus, type BrowserInstallStatus } from './install-status.js';
import {
  DEFAULT_PLAYWRIGHT_CHROMIUM_VARIANT,
  playwrightChromiumInstallCliArgs,
  type PlaywrightChromiumVariant,
} from './playwright-chromium-variant.js';

const require = createRequire(import.meta.url);

export type EnsureOwnedChromiumProgress = {
  downloading: () => void;
};

export type EnsureOwnedChromium = (progress: EnsureOwnedChromiumProgress) => Promise<void>;

export type PlaywrightChromiumInstallInput = {
  browsersPath: string;
  variant?: PlaywrightChromiumVariant;
  signal?: AbortSignal;
};

export type PlaywrightChromiumInstaller = (
  input: PlaywrightChromiumInstallInput,
) => Promise<void>;

export function resolvePlaywrightCoreCliPath(): string {
  const packageJsonPath = require.resolve('playwright-core/package.json');
  return join(dirname(packageJsonPath), 'cli.js');
}

export async function installPlaywrightChromium(
  input: PlaywrightChromiumInstallInput,
): Promise<void> {
  if (input.signal?.aborted) {
    throw new AbortOperationError('operation aborted');
  }
  const cliPath = resolvePlaywrightCoreCliPath();
  const variant = input.variant ?? DEFAULT_PLAYWRIGHT_CHROMIUM_VARIANT;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...playwrightChromiumInstallCliArgs(variant)], {
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: input.browsersPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onAbort = (): void => {
      child.kill('SIGTERM');
    };
    input.signal?.addEventListener('abort', onAbort, { once: true });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      input.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code, signal) => {
      input.signal?.removeEventListener('abort', onAbort);
      if (input.signal?.aborted) {
        reject(new AbortOperationError('operation aborted'));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim().replace(/\s+/g, ' ').slice(0, 400);
      const reason =
        signal !== null
          ? `playwright install chromium terminated (${signal})`
          : `playwright install chromium exited ${String(code)}`;
      reject(new Error(detail.length > 0 ? `${reason}: ${detail}` : reason));
    });
  });
}

export async function ensurePlaywrightChromium(options: {
  browsersPath: string;
  variant?: PlaywrightChromiumVariant;
  signal?: AbortSignal;
  getStatus?: () => Promise<BrowserInstallStatus> | BrowserInstallStatus;
  install?: PlaywrightChromiumInstaller;
}): Promise<BrowserInstallStatus> {
  const variant = options.variant ?? DEFAULT_PLAYWRIGHT_CHROMIUM_VARIANT;
  const getStatus =
    options.getStatus ?? (() => getBrowserInstallStatus({ variant }));
  const existing = await getStatus();
  if (existing.available) return existing;
  try {
    await (options.install ?? installPlaywrightChromium)({
      browsersPath: options.browsersPath,
      variant,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof AbortOperationError) throw error;
    throw new BrowserUnavailableError(
      `failed to download Chromium into ${options.browsersPath} (${error instanceof Error ? error.message : String(error)})`,
      { cause: error, reason: 'binary-missing' },
    );
  }
  const installed = await getStatus();
  if (installed.available) return installed;
  throw new BrowserUnavailableError(
    `Chromium is still missing after install at ${options.browsersPath}. ${installed.hint ?? ''}`.trim(),
    { reason: 'binary-missing' },
  );
}
