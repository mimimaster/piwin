/**
 * Element pick: locate the DOM element under a viewport CSS px point and return a
 * stable CSS selector (`@medv/finder`), bounded innerText/outerHTML, the bounding
 * rect, and a best-effort a11y snapshot `ref` matched via `[box=…]` annotations.
 *
 * `@medv/finder` is browser-side, so it is bundled to a self-contained IIFE via
 * esbuild and injected with `page.addInitScript` (re-runs on every navigation).
 * The pick evaluation is written as a script string because this package compiles
 * without a DOM lib (tsconfig.base `lib: ["ES2022"]`).
 */
import { MAX_WEB_ELEMENT_HTML_BYTES, MAX_WEB_ELEMENT_TEXT_BYTES } from '@piwin/contracts';
import type { WebElementPickResult } from '@piwin/contracts';
import { buildSync } from 'esbuild';
import { matchRefByPoint, parseAriaSnapshot } from './snapshot.js';

const FINDER_GLOBAL = 'FinderModule';

/** The parts of a Playwright Page that pick uses (structural, for easy mocking). */
export interface PickPage {
  evaluate<R>(pageFunction: string): Promise<R>;
  locator(selector: string): {
    ariaSnapshot(options: { mode: 'ai'; boxes: boolean }): Promise<string>;
  };
}

/** A Playwright page or browser context that can install init scripts. */
export type InitScriptTarget = {
  addInitScript(options: { content: string }): Promise<unknown>;
};

export type PickedElement = {
  selector: string;
  text: string;
  html?: string;
  ref?: string;
  boundingRect: WebElementPickResult['boundingRect'];
};

export class PickError extends Error {
  readonly name = 'PickError';
}

let finderBundleCache: string | null = null;

/** Bundles `@medv/finder` into a self-contained IIFE string, cached after first build. */
export function getFinderBundle(): string {
  if (finderBundleCache === null) {
    const result = buildSync({
      entryPoints: ['@medv/finder'],
      bundle: true,
      format: 'iife',
      globalName: FINDER_GLOBAL,
      platform: 'browser',
      write: false,
      logLevel: 'silent',
      // Playwright evaluates init-script strings inside a function wrapper, so a
      // top-level `var FinderModule = …` would be function-scoped and never reach
      // `window`. Re-assign the global explicitly so page.evaluate can read it.
      footer: { js: `window.${FINDER_GLOBAL} = ${FINDER_GLOBAL};` },
    });
    const output = result.outputFiles?.[0]?.text;
    if (output === undefined || output === '') {
      throw new Error('failed to bundle @medv/finder for page injection');
    }
    finderBundleCache = output;
  }
  return finderBundleCache;
}

/**
 * Installs the finder bundle as an init script on a context/page. Context-level
 * injection (before `newPage`) also covers the initial about:blank document;
 * `addInitScript` re-runs on every navigation either way.
 */
export async function injectFinder(target: InitScriptTarget): Promise<void> {
  await target.addInitScript({ content: getFinderBundle() });
}

/** Picks the element at a viewport point, without the current page URL/screenshot. */
export async function pickElementAt(page: PickPage, x: number, y: number): Promise<PickedElement> {
  const element = await page.evaluate<PickElementResult | null>(pickPageScript(x, y));
  if (element === null || element === undefined) {
    throw new PickError(`no element at (${x}, ${y})`);
  }

  // Best-effort ref: the deepest snapshot box containing the point. Omitted on
  // any failure (e.g. mid-navigation snapshot) — the CSS selector is the anchor.
  let ref: string | undefined;
  try {
    const yamlText = await page.locator('html').ariaSnapshot({ mode: 'ai', boxes: true });
    ref = matchRefByPoint(parseAriaSnapshot(yamlText), x, y);
  } catch {
    ref = undefined;
  }

  return {
    selector: element.selector,
    text: element.text,
    boundingRect: element.rect,
    ...(ref !== undefined ? { ref } : {}),
    ...(element.html !== '' ? { html: element.html } : {}),
  };
}

type PickElementResult = {
  selector: string;
  text: string;
  html: string;
  rect: { x: number; y: number; width: number; height: number };
};

/**
 * Page-side pick logic as a script string (runs in the browser context where DOM
 * globals exist). Coordinates are clamped into the viewport before
 * `elementFromPoint`. `finder` resolves to the injected `FinderModule.finder`.
 */
function pickPageScript(x: number, y: number): string {
  const maxText = MAX_WEB_ELEMENT_TEXT_BYTES;
  const maxHtml = MAX_WEB_ELEMENT_HTML_BYTES;
  return `(() => {
    'use strict';
    const x = ${JSON.stringify(x)};
    const y = ${JSON.stringify(y)};
    const cx = Math.max(0, Math.min(window.innerWidth - 1, x));
    const cy = Math.max(0, Math.min(window.innerHeight - 1, y));
    const target = document.elementFromPoint(cx, cy);
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    const finder = window.${FINDER_GLOBAL} && window.${FINDER_GLOBAL}.finder;
    const selector = typeof finder === 'function' ? finder(target) : '';
    const text = (target.innerText || '').slice(0, ${maxText});
    const html = (target.outerHTML || '').slice(0, ${maxHtml});
    return {
      selector: selector,
      text: text,
      html: html,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  })()`;
}
