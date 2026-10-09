import { describe, expect, it } from 'vitest';
import { formatTuiSessionAnnouncement, parseTuiSessionAnnouncement } from './embedded-tui.js';

describe('session announcement', () => {
  it('round-trips a session id through the OSC payload', () => {
    const osc = formatTuiSessionAnnouncement('session-mv0-abc');
    expect(osc).toBe('\x1b]777;piwin;session;session-mv0-abc\x07');
    const payload = osc.slice('\x1b]777;'.length, -1);
    expect(parseTuiSessionAnnouncement(payload)).toBe('session-mv0-abc');
  });

  it('cannot be made to end the sequence early', () => {
    expect(formatTuiSessionAnnouncement('a\x07b\x1b[31m')).toBe('\x1b]777;piwin;session;ab31m\x07');
  });

  it('ignores other 777 strings and malformed ids', () => {
    expect(parseTuiSessionAnnouncement('notify;title;body')).toBeUndefined();
    expect(parseTuiSessionAnnouncement('piwin;session;')).toBeUndefined();
    expect(parseTuiSessionAnnouncement('piwin;session;a b')).toBeUndefined();
  });
});
