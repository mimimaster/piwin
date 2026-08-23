/**
 * Decide whether a Host browser push should reveal the right-sidebar
 * Browser workbench. Agent write tools emit `browser/controller` with
 * owner=agent; navigate also emits `browser/state` with a real URL.
 * Frames are ignored: they only exist after the panel already holds a
 * mirror lease.
 */
import type { HostServerMessage } from '@piwin/contracts';

export function shouldRevealBrowserInspector(message: HostServerMessage): boolean {
  if (message.type === 'browser/controller') {
    return message.owner === 'agent';
  }
  if (message.type === 'browser/state') {
    const url = message.url?.trim() ?? '';
    return url.length > 0 && url !== 'about:blank';
  }
  return false;
}
