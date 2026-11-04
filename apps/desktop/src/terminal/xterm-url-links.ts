/**
 * Clickable http(s) links in a shell surface.
 *
 * xterm ships only the OSC 8 provider, so a URL that a build tool, a test
 * runner, or `git log` prints as plain text is dead until a link provider finds
 * it. Opening goes through `openExternalUrl`: Tauri hands the URL to the system
 * browser, and the desktop webview's `window.open` (used by xterm's default
 * handler behind a confirm()) does nothing there.
 */
import type { IDisposable, ILink, Terminal } from '@xterm/xterm';
import { openExternalUrl } from '../platform/open-external-url.js';
import { findTerminalUrls } from './terminal-url-link.js';

export function attachTerminalUrlLinks(terminal: Terminal): IDisposable {
  return terminal.registerLinkProvider({
    provideLinks(rowNumber, callback) {
      const line = terminal.buffer.active.getLine(rowNumber - 1);
      if (line === undefined) {
        callback(undefined);
        return;
      }
      const urls = findTerminalUrls(line.translateToString(true));
      if (urls.length === 0) {
        callback(undefined);
        return;
      }
      callback(urls.map((url): ILink => ({
        text: url.text,
        // xterm ranges are 1-based and inclusive on both ends.
        range: {
          start: { x: url.start + 1, y: rowNumber },
          end: { x: url.end, y: rowNumber },
        },
        activate: () => {
          void openExternalUrl(url.text);
        },
      })));
    },
  });
}
