/** Host-owned browser registry: one lazy resource per conversation. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { BrowserSession } from '@piwin/browser';
import {
  BROWSER_DEFAULT_VIEWPORT_HEIGHT,
  BROWSER_DEFAULT_VIEWPORT_WIDTH,
  formatError,
} from '@piwin/contracts';
import { loadPiwinConfig } from './config-store.js';
import { applyPiwinPlaywrightBrowsersPath, getPiwinRoot } from './paths.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';

/**
 * Lazily create the host-owned BrowserSession (ADR 0020). The session object
 * and its push subscription are passive — Chromium launches only when the
 * desktop acquires its mirror lease or an agent performs a browser operation.
 * Frame/state events are forwarded to `this.push` so the desktop panel
 * mirrors the agent's page. Must run before Host tool composition so
 * `browser_*` tools register without making Chromium resident. Create, cold
 * activate, and generation rebuild all compose tools; skipping this omits
 * the browser family even though bash/fs still appear.
 */
/**
 * Raw JPEG sink for the out-of-band browser frame channel. Host-server
 * registers one per process; the local JSONL path never needs it.
 */
export type BrowserFrameBytesSink = (
  header: import('@piwin/contracts').BrowserFrameBinaryHeader,
  bytes: Uint8Array,
) => void;

export async function ensureBrowserSession(
  deps: HostRuntimeKernel,
  sessionId?: string,
): Promise<BrowserSession> {
  if (deps.hostClosing) throw new Error('Host is closing');
  const key = sessionId ?? '';
  const existing = deps.browserSessions.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const { createBrowserSession, ensurePlaywrightChromium, getBrowserInstallStatus } =
      await import('@piwin/browser');
    const rootDir = getPiwinRoot(deps.options.piwinRoot);
    const browsersPath = applyPiwinPlaywrightBrowsersPath(rootDir);
    const config = await loadPiwinConfig(rootDir);
    const cdpEndpoint = config.browser?.cdpEndpoint;
    // Host-owned CSS viewport is fixed 1280×800; the panel only scales display.
    const baseProfileDir = config.browser?.profileDir ?? join(rootDir, 'browser-profile');
    const profileDir =
      sessionId === undefined
        ? baseProfileDir
        : join(baseProfileDir, 'sessions', createHash('sha256').update(sessionId).digest('hex'));
    const scope = sessionId === undefined ? {} : { sessionId };
    const session = createBrowserSession({
      keepAlive: sessionId !== undefined,
      isolatedContext: sessionId !== undefined,
      viewport: {
        width: BROWSER_DEFAULT_VIEWPORT_WIDTH,
        height: BROWSER_DEFAULT_VIEWPORT_HEIGHT,
      },
      headless: config.browser?.headless !== false,
      profileDir,
      captureConsoleAndNetwork: true,
      ...(typeof config.browser?.deviceScaleFactor === 'number'
        ? { deviceScaleFactor: config.browser.deviceScaleFactor }
        : {}),
      ...(typeof config.browser?.quality === 'number'
        ? { screencastQuality: config.browser.quality }
        : {}),
      ...(typeof config.browser?.userAgent === 'string'
        ? { userAgent: config.browser.userAgent }
        : {}),
      ...(typeof config.browser?.channel === 'string' ? { channel: config.browser.channel } : {}),
      ...(Array.isArray(config.browser?.args) ? { args: config.browser.args } : {}),
      // Raw bytes stay available for the remote binary channel; the local
      // JSON path keeps the inline payload (spec §4.1.2).
      onFrameBytes: (header, bytes) => {
        for (const sink of [...deps.browserFrameSinks]) {
          try {
            sink({ ...header, ...scope }, bytes);
          } catch (error) {
            console.warn(
              '[piwin host] browser frame sink failed',
              error instanceof Error ? error.message : error,
            );
          }
        }
      },
      ...(cdpEndpoint !== undefined
        ? { cdpEndpoint }
        : {
            ensureChromium: async ({ downloading }) => {
              const variant = config.browser?.variant ?? 'chromium';
              const status = await getBrowserInstallStatus({ variant });
              if (status.available) return;
              downloading();
              await ensurePlaywrightChromium({ browsersPath, variant });
            },
          }),
    });
    if (deps.hostClosing) {
      await session.close();
      throw new Error('Host is closing');
    }
    session.subscribe((event) => deps.push({ ...event, ...scope }));
    return session;
  })();
  deps.browserSessions.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    deps.browserSessions.delete(key);
    throw error;
  }
}

/**
 * Best-effort BrowserSession registration for tool composition. Mock hosts
 * stay tool-less. Failure must not block session create/activate — the
 * `browser_*` family is simply omitted.
 */
export async function ensureBrowserSessionBestEffort(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<BrowserSession | undefined> {
  if (deps.options.mock === true) return;
  try {
    return await ensureBrowserSession(deps, sessionId);
  } catch (error) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `browser session init failed: ${formatError(error)}`,
    });
  }
}

export async function disposeBrowserSessions(deps: HostRuntimeKernel): Promise<unknown[]> {
  const sessions = await Promise.allSettled([...deps.browserSessions.values()]);
  deps.browserSessions.clear();
  const closed = await Promise.allSettled(
    sessions.map(async (result) => {
      if (result.status === 'fulfilled') await result.value.close();
    }),
  );
  return closed.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
}

export function releaseBrowserRun(deps: HostRuntimeKernel, sessionId: string, runId: string): void {
  const pending = deps.browserSessions.get(sessionId);
  if (!pending) return;
  void pending
    .then((session) => session.releaseAgentControlIfHeldBy(runId))
    .catch((error: unknown) => {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `browser control release failed: ${formatError(error)}`,
      });
    });
}
