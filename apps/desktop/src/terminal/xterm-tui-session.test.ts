// @vitest-environment happy-dom
import { Terminal } from '@xterm/xterm';
import { formatTuiSessionAnnouncement } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { listenForTuiSession } from './xterm-tui-session';

const written = (terminal: Terminal, data: string): Promise<void> =>
  new Promise((resolve) => terminal.write(data, resolve));

describe('listenForTuiSession', () => {
  it('reports the session an embedded TUI announces', async () => {
    const terminal = new Terminal();
    const seen = vi.fn();
    listenForTuiSession(terminal, seen);
    await written(terminal, `draw${formatTuiSessionAnnouncement('session-9')}more`);
    expect(seen).toHaveBeenCalledWith('session-9');
  });

  it('ignores other OSC 777 strings', async () => {
    const terminal = new Terminal();
    const seen = vi.fn();
    listenForTuiSession(terminal, seen);
    await written(terminal, '\x1b]777;notify;title;body\x07');
    expect(seen).not.toHaveBeenCalled();
  });

  it('stops listening once disposed', async () => {
    const terminal = new Terminal();
    const seen = vi.fn();
    const stop = listenForTuiSession(terminal, seen);
    stop();
    await written(terminal, formatTuiSessionAnnouncement('session-9'));
    expect(seen).not.toHaveBeenCalled();
  });
});
