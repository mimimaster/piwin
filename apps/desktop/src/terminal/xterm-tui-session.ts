import type { Terminal } from '@xterm/xterm';
import { TUI_SESSION_OSC, parseTuiSessionAnnouncement } from '@piwin/contracts';

/**
 * `piwin tui --embedded` says which session it shows with an OSC 777 string.
 * Other 777 strings (desktop notifications from some other program) are left
 * to the terminal. Returns the handler's disposer.
 */
export function listenForTuiSession(terminal: Terminal, onSession: (sessionId: string) => void): () => void {
  const handler = terminal.parser.registerOscHandler(TUI_SESSION_OSC, (payload) => {
    const sessionId = parseTuiSessionAnnouncement(payload);
    if (sessionId === undefined) return false;
    onSession(sessionId);
    return true;
  });
  return () => handler.dispose();
}
