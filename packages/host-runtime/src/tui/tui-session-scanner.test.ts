import { describe, expect, it } from 'vitest';
import { formatTuiSessionAnnouncement } from '@piwin/contracts';
import { TuiSessionScanner } from './tui-session-scanner.js';

describe('TuiSessionScanner', () => {
  it('finds the last announcement in a chunk', () => {
    const scanner = new TuiSessionScanner();
    const chunk = `draw${formatTuiSessionAnnouncement('s1')}more${formatTuiSessionAnnouncement('s2')}end`;
    expect(scanner.scan(chunk)).toBe('s2');
    expect(scanner.scan('plain output')).toBeUndefined();
  });

  it('joins an announcement split across chunks, even inside the opening sequence', () => {
    const osc = formatTuiSessionAnnouncement('session-abc');
    for (const cut of [1, 3, 6, 12, osc.length - 1]) {
      const scanner = new TuiSessionScanner();
      expect(scanner.scan(`x${osc.slice(0, cut)}`)).toBeUndefined();
      expect(scanner.scan(`${osc.slice(cut)}y`)).toBe('session-abc');
    }
  });

  it('ignores other 777 strings and drops runaway ones', () => {
    const scanner = new TuiSessionScanner();
    expect(scanner.scan('\x1b]777;notify;title;body\x07')).toBeUndefined();
    expect(scanner.scan(`\x1b]777;piwin;session;${'x'.repeat(600)}`)).toBeUndefined();
    expect(scanner.scan('\x07')).toBeUndefined();
    expect(scanner.scan(formatTuiSessionAnnouncement('s3'))).toBe('s3');
  });
});
