import { describe, expect, it } from 'vitest';
import {
  formatHostListenBusyError,
  isAddressInUseError,
  isLikelyPiwinHostCommand,
  parseLsofDashF,
} from './listen-busy.js';

describe('listen-busy', () => {
  it('detects Node EADDRINUSE', () => {
    const error = new Error('listen EADDRINUSE: address already in use 127.0.0.1:8787');
    (error as NodeJS.ErrnoException).code = 'EADDRINUSE';
    expect(isAddressInUseError(error)).toBe(true);
    expect(isAddressInUseError(new Error('boom'))).toBe(false);
  });

  it('parses lsof -F pc', () => {
    expect(parseLsofDashF('p749\ncGrok\n')).toEqual({ pid: 749, command: 'Grok' });
  });

  it('tells a foreign occupant to pick another port', () => {
    const message = formatHostListenBusyError({
      host: '127.0.0.1',
      port: 8787,
      occupant: { pid: 749, command: '/Applications/Grok.app/Contents/MacOS/Grok' },
    }).message;
    expect(message).toContain('pid 749');
    expect(message).toContain('not a piwin Host');
    expect(message).toContain('PIWIN_HOST_PORT=8788');
    expect(message).toContain('ws://127.0.0.1:8788');
    expect(isLikelyPiwinHostCommand('/Applications/Grok.app/Contents/MacOS/Grok')).toBe(false);
  });

  it('tells a leftover piwin Host to stop first', () => {
    const command = 'node apps/host/src/index.ts';
    expect(isLikelyPiwinHostCommand(command)).toBe(true);
    const message = formatHostListenBusyError({
      host: '127.0.0.1',
      port: 8787,
      occupant: { pid: 12, command },
    }).message;
    expect(message).toContain('already a piwin Host');
    expect(message).not.toContain('PIWIN_HOST_PORT=8788');
  });
});
