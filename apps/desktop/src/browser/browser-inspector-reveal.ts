/**
 * Decide whether a Host browser push should reveal the right-sidebar
 * Browser workbench. Only agent activity can request attention. State/frame
 * pushes and mirror-start echoes describe an existing page; treating them as
 * an open request would recreate a tool tab the reader just closed.
 */
import type { HostServerMessage } from '@piwin/contracts';

export function shouldRevealBrowserInspector(
  message: HostServerMessage,
  activeSessionId?: string | null,
): boolean {
  if (activeSessionId === null) return false;
  if (activeSessionId !== undefined &&
      (!('sessionId' in message) || message.sessionId !== activeSessionId)) return false;
  if (message.type === 'browser/controller') {
    return message.owner === 'agent' && message.reason !== 'mirror-start';
  }
  return false;
}
