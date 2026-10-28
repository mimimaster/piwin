/**
 * Build-time only: inline the launch splash into a mobile shell entry page.
 *
 * Both shell entries get it — the web workbench page (by build-shell-dist) and
 * the classic page (by the Vite plugin in vite.config.ts). Desktop builds of the
 * workbench never pass through here, so Desktop keeps its own boot placeholder.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function readAsset(name: string): string {
  return readFileSync(join(here, name), 'utf8').trim();
}

export function injectLaunchSplash(html: string): string {
  if (html.includes('id="launch-splash"')) {
    return html;
  }
  const headClose = html.search(/<\/head>/i);
  const bodyClose = html.search(/<\/body>/i);
  if (headClose === -1 || bodyClose === -1) {
    throw new Error('shell entry page needs <head> and <body> to carry the launch splash');
  }
  const style = `<style id="launch-splash-style">${readAsset('launch-splash.css')}</style>`;
  // At the end of <body>: #root already exists when the controller runs, and the
  // deferred app module has not executed yet.
  const body = `${readAsset('launch-splash.html')}<script id="launch-splash-script">${readAsset('launch-splash.js')}</script>`;
  return `${html.slice(0, headClose)}${style}${html.slice(headClose, bodyClose)}${body}${html.slice(bodyClose)}`;
}
