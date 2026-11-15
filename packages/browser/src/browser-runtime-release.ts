/** Resource shutdown only; residency eligibility belongs to BrowserSession. */
import type { Browser, BrowserContext } from 'playwright-core';
import type { BrowserOwnership } from './browser-cdp.js';
import { isDeadBrowserError } from './browser-errors.js';

export async function disconnectBrowser(target: Browser | undefined): Promise<void> {
  if (target === undefined) return;
  try {
    const disconnectable = target as Browser & { disconnect?: () => unknown };
    if (typeof disconnectable.disconnect === 'function') {
      await Promise.resolve(disconnectable.disconnect());
      return;
    }
    // For a connected Playwright Browser, close detaches this connection.
    await target.close();
  } catch (error) {
    if (isDeadBrowserError(error)) return;
    console.warn('[browser] cdp disconnect failed', error instanceof Error ? error.message : error);
  }
}

export async function releaseBrowserRuntimeResources(input: {
  context: BrowserContext | undefined;
  browser: Browser | undefined;
  ownership: BrowserOwnership;
  isolatedContext: boolean;
}): Promise<void> {
  if (input.ownership === 'attached') {
    if (input.isolatedContext) await input.context?.close();
    await disconnectBrowser(input.browser);
    return;
  }
  let contextCloseError: unknown;
  if (input.context !== undefined) {
    try {
      await input.context.close();
      return;
    } catch (error) {
      if (isDeadBrowserError(error)) return;
      contextCloseError = error;
    }
  }
  if (input.browser !== undefined) {
    try {
      await input.browser.close();
      return;
    } catch (error) {
      if (isDeadBrowserError(error)) {
        if (contextCloseError instanceof Error && !isDeadBrowserError(contextCloseError)) throw contextCloseError;
        return;
      }
      if (contextCloseError !== undefined) {
        throw new AggregateError([contextCloseError, error], 'browser runtime cleanup failed');
      }
      throw error;
    }
  }
  if (contextCloseError instanceof Error) throw contextCloseError;
}
