/**
 * Page display box for the browser workbench (spec §4.1).
 *
 * `fit` never upscales: the page is shown at most at 1 CSS px per CSS viewport
 * px, centred when the panel is larger. `100` is always 1:1 and the container
 * scrolls when the panel is smaller.
 */
export type BrowserDisplayZoom = 'fit' | '100';

export type BrowserDisplayBox = {
  width: number;
  height: number;
  /** Displayed CSS px / viewport CSS px. Always ≤ 1 in fit mode. */
  scale: number;
};

export function resolveBrowserDisplayBox(input: {
  panelWidth: number;
  panelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  zoom: BrowserDisplayZoom;
}): BrowserDisplayBox {
  if (input.viewportWidth <= 0 || input.viewportHeight <= 0) {
    return { width: 0, height: 0, scale: 1 };
  }
  const scale =
    input.zoom === '100'
      ? 1
      : Math.min(
          1,
          input.panelWidth > 0 ? input.panelWidth / input.viewportWidth : 1,
          input.panelHeight > 0 ? input.panelHeight / input.viewportHeight : 1,
        );
  return {
    width: Math.max(1, Math.round(input.viewportWidth * scale)),
    height: Math.max(1, Math.round(input.viewportHeight * scale)),
    scale,
  };
}

export function formatBrowserZoomPercent(scale: number): string {
  return `${String(Math.round(scale * 100))}%`;
}
