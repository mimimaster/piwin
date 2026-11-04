import type { Page } from 'playwright-core';

export const CLOUDFLARE_DEFAULT_SOLVE_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 500;

/**
 * Returns true if the page title or content indicates a Cloudflare challenge
 * or waiting screen ("Just a moment...", "请稍候…", etc.).
 */
export async function isCloudflareChallengePage(page: Page): Promise<boolean> {
  try {
    const title = await page.title();
    if (
      title.includes('Just a moment') ||
      title.includes('请稍候') ||
      title.includes('Attention Required! | Cloudflare')
    ) {
      return true;
    }
    return await page.evaluate(() => {
      const globalScope = globalThis as unknown as {
        _cf_chl_opt?: unknown;
        document?: {
          querySelector?: (selector: string) => unknown;
        };
      };
      if (globalScope._cf_chl_opt !== undefined) return true;
      const turnstileInput = globalScope.document?.querySelector?.(
        'input[name="cf-turnstile-response"]',
      );
      return Boolean(turnstileInput);
    });
  } catch {
    return false;
  }
}

export type SolveCloudflareOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * Detects and automatically interacts with Cloudflare Turnstile / Managed Challenges.
 * When a Turnstile iframe with an interactive verification checkbox is present,
 * it clicks the verification target and waits for clearance and page redirect.
 */
export async function trySolveCloudflareChallenge(
  page: Page,
  options?: SolveCloudflareOptions,
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? CLOUDFLARE_DEFAULT_SOLVE_TIMEOUT_MS;
  const signal = options?.signal;
  const startTime = Date.now();
  let clicked = false;

  while (Date.now() - startTime < timeoutMs) {
    if (signal?.aborted) return false;

    const title = await page.title().catch(() => '');
    const isChallengeTitle =
      title.includes('Just a moment') ||
      title.includes('请稍候') ||
      title.includes('Attention Required! | Cloudflare');

    if (!isChallengeTitle && title.trim().length > 0) {
      return true;
    }

    if (!clicked) {
      const frames = page.frames();
      const cfFrame = frames.find((f) => {
        const u = f.url();
        return u.includes('challenges.cloudflare.com') || u.includes('turnstile');
      });

      if (cfFrame) {
        try {
          const elem = await cfFrame.frameElement();
          const box = await elem.boundingBox();
          // Interactive Turnstile box is standard ~300x65px (avoid hidden 1x1 submission frames)
          if (box && box.width >= 100 && box.height >= 30) {
            const clickX = Math.round(box.x + 30);
            const clickY = Math.round(box.y + box.height / 2);
            await page.mouse.click(clickX, clickY);
            clicked = true;
          }
        } catch {
          // Frame may be re-rendering or navigating
        }
      }
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, POLL_INTERVAL_MS);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      }
    });
  }

  const finalTitle = await page.title().catch(() => '');
  return (
    !finalTitle.includes('Just a moment') &&
    !finalTitle.includes('请稍候') &&
    !finalTitle.includes('Attention Required! | Cloudflare') &&
    finalTitle.trim().length > 0
  );
}
