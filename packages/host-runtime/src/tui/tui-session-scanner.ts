import { TUI_SESSION_OSC, parseTuiSessionAnnouncement } from '@piwin/contracts';

const START = `\x1b]${TUI_SESSION_OSC};`;
const END = '\x07';
/** An announcement is short; anything longer is some other program's string. */
const MAX_PENDING_CHARS = 512;

/**
 * Follows the session a Host-run TUI shows by reading the announcements it
 * writes into its own output. Terminal output arrives in arbitrary chunks, so
 * an announcement split across two chunks is carried over.
 */
export class TuiSessionScanner {
  private pending = '';

  /** The last session announced in this chunk, if any. */
  public scan(chunk: string): string | undefined {
    const text = this.pending + chunk;
    this.pending = '';
    let latest: string | undefined;
    let from = 0;
    for (;;) {
      const start = text.indexOf(START, from);
      if (start < 0) break;
      const end = text.indexOf(END, start + START.length);
      if (end < 0) {
        const rest = text.slice(start);
        this.pending = rest.length <= MAX_PENDING_CHARS ? rest : '';
        return latest;
      }
      latest = parseTuiSessionAnnouncement(text.slice(start + START.length, end)) ?? latest;
      from = end + END.length;
    }
    this.pending = partialStartAtEnd(text);
    return latest;
  }
}

/** The longest prefix of the opening sequence that the text ends with. */
function partialStartAtEnd(text: string): string {
  for (let length = START.length - 1; length > 0; length -= 1) {
    if (text.endsWith(START.slice(0, length))) return START.slice(0, length);
  }
  return '';
}
