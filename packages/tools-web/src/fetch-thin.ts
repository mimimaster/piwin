import { FETCH_THIN_HTML_CHARS, FETCH_THIN_TEXT_CHARS } from './fetch-caps.js';

const SPA_SHELL_MARKERS: readonly RegExp[] = [
  /__NEXT_DATA__/u,
  /__NUXT__/u,
  /id=["']__nuxt["']/iu,
  /id=["']root["']/iu,
  /id=["']app["']/iu,
  /data-reactroot/iu,
  /ng-version=/iu,
];

/** True when Readability extracted almost nothing from a likely JS-rendered page. */
export function detectThinContent(text: string, html: string): boolean {
  if (text.trim().length >= FETCH_THIN_TEXT_CHARS) {
    return false;
  }
  return html.length > FETCH_THIN_HTML_CHARS || looksLikeSpaShell(html);
}

export function looksLikeSpaShell(html: string): boolean {
  return SPA_SHELL_MARKERS.some((marker) => marker.test(html));
}
