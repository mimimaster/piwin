import { describe, expect, it } from 'vitest';
import {
  formatTuiSessionAnnouncement,
  isEmbeddedTuiOpenInput,
  isSafeTuiSessionId,
  parseTuiSessionAnnouncement,
} from './embedded-tui.js';

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

describe('tui/open input', () => {
  it('accepts a session, a project or nothing, with a terminal grid', () => {
    expect(isEmbeddedTuiOpenInput({ cols: 48, rows: 30 })).toBe(true);
    expect(isEmbeddedTuiOpenInput({ sessionId: 'session-mv0-abc', cols: 48, rows: 30 })).toBe(true);
    expect(isEmbeddedTuiOpenInput({ projectPath: 'prj_abc', cols: 48, rows: 30 })).toBe(true);
  });

  it('rejects anything that could reach the command line or the spawn', () => {
    expect(isEmbeddedTuiOpenInput({ sessionId: '--help', cols: 48, rows: 30 })).toBe(false);
    expect(isEmbeddedTuiOpenInput({ sessionId: 'a b', cols: 48, rows: 30 })).toBe(false);
    expect(isEmbeddedTuiOpenInput({ projectPath: 'a\0b', cols: 48, rows: 30 })).toBe(false);
    expect(isEmbeddedTuiOpenInput({ cols: 48, rows: 30, executable: '/bin/sh' })).toBe(false);
    expect(isEmbeddedTuiOpenInput({ cols: 0, rows: 30 })).toBe(false);
    expect(isEmbeddedTuiOpenInput(null)).toBe(false);
  });

  it('matches the native launcher session id rule', () => {
    expect(isSafeTuiSessionId('s:1.a_b-c')).toBe(true);
    expect(isSafeTuiSessionId('-x')).toBe(false);
    expect(isSafeTuiSessionId('x'.repeat(129))).toBe(false);
  });
});
