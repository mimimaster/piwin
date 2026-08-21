/** Host composition for ADR 0058 `web_fetch` browser fallback. */

import type { WebPageRenderer } from '@piwin/contracts';
import { renderPageHtml } from '@piwin/browser';

export type BuildWebPageRendererDependencies = {
  render?: typeof renderPageHtml;
};

/** Isolated headless render. Never reuses the workbench BrowserSession. */
export function buildWebPageRenderer(
  dependencies: BuildWebPageRendererDependencies = {},
): WebPageRenderer {
  const render = dependencies.render ?? renderPageHtml;
  return {
    renderHtml: (input) => render(input),
  };
}
