/** One-shot headless HTML render for `web_fetch` fallback (ADR 0058). */

import { chromium, type Browser } from 'playwright-core';

export class FetchRenderUnavailableError extends Error {
  override name = 'FetchRenderUnavailableError';
}

export type RenderPageHtmlInput = {
  url: string;
  signal?: AbortSignal;
  timeoutMs: number;
};

export type RenderPageHtmlResult = {
  finalUrl: string;
  html: string;
};

export type RenderPageHtmlDependencies = {
  launch?: (options: { headless: boolean }) => Promise<Browser>;
};

/**
 * Launch a throwaway Chromium, navigate, read DOM, close.
 * Must not use the workbench persistent profile or emit panel pushes.
 */
export async function renderPageHtml(
  input: RenderPageHtmlInput,
  dependencies: RenderPageHtmlDependencies = {},
): Promise<RenderPageHtmlResult> {
  if (input.signal?.aborted) {
    throw new Error('web_fetch browser render aborted');
  }
  const launch = dependencies.launch ?? ((options: { headless: boolean }) => chromium.launch(options));
  let browser: Browser | undefined;
  try {
    browser = await launch({ headless: true });
  } catch (error) {
    throw new FetchRenderUnavailableError(
      'headless Chromium could not be launched. Install it with: ' +
        'pnpm --dir apps/desktop e2e:install',
      { cause: error },
    );
  }
  try {
    const context = await browser.newContext({ userAgent: 'piwin-web-fetch/0.1' });
    try {
      const page = await context.newPage();
      const onAbort = () => {
        void page.close();
      };
      input.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        if (input.signal?.aborted) {
          throw new Error('web_fetch browser render aborted');
        }
        await page.goto(input.url, { timeout: input.timeoutMs, waitUntil: 'load' });
        return {
          finalUrl: page.url(),
          html: await page.content(),
        };
      } finally {
        input.signal?.removeEventListener('abort', onAbort);
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
