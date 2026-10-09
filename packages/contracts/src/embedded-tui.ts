/**
 * An embedded TUI tells the terminal emulator around it which session it now
 * shows, as an OSC 777 string only that emulator reads (`piwin;session;<id>`).
 * Desktop follows it, so a conversation started in the terminal becomes the
 * conversation Desktop has open. Other terminals ignore unknown OSC strings.
 */
/** The OSC number the announcement travels under. */
export const TUI_SESSION_OSC = 777;
const PREFIX = 'piwin;session;';

export function formatTuiSessionAnnouncement(sessionId: string): string {
  // The id rides inside an escape sequence: anything that could end it early is dropped.
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '');
  return `\x1b]${TUI_SESSION_OSC};${PREFIX}${safe}\x07`;
}

/** The session id in an OSC 777 payload (what follows `777;`), or undefined for any other 777 string. */
export function parseTuiSessionAnnouncement(payload: string): string | undefined {
  if (!payload.startsWith(PREFIX)) return undefined;
  const sessionId = payload.slice(PREFIX.length);
  return /^[A-Za-z0-9._-]+$/.test(sessionId) ? sessionId : undefined;
}
