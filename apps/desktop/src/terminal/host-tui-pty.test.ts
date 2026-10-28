import type { HostCommand } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createHostTuiPty } from './host-tui-pty';

describe('Host-run terminal shell', () => {
  it('opens through tui/open with a gesture key and streams over the Host connection', async () => {
    const request = vi.fn(async (command: HostCommand) => ({
      type: 'response' as const,
      command: command.type,
      success: true as const,
      data: command.type === 'tui/open' ? { ptyId: 'host-pty' } : {},
    }));
    const pty = createHostTuiPty({ request, subscribe: () => () => undefined }, { sessionId: 'session-1' });
    await expect(pty.open({ cols: 48, rows: 30 })).resolves.toEqual({ pty_id: 'host-pty' });
    expect(request).toHaveBeenCalledWith(
      { type: 'tui/open', input: { sessionId: 'session-1', cols: 48, rows: 30 } },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    await pty.transport.write('host-pty', 'q');
    expect(request).toHaveBeenLastCalledWith({ type: 'pty/write', ptyId: 'host-pty', data: 'q' });
  });

  it('surfaces the Host refusal', async () => {
    const request = vi.fn(async (command: HostCommand) => ({
      type: 'response' as const, command: command.type, success: false as const, error: 'embedded-tui-unavailable',
    }));
    const pty = createHostTuiPty({ request, subscribe: () => () => undefined }, {});
    await expect(pty.open({ cols: 48, rows: 30 })).rejects.toThrow('embedded-tui-unavailable');
  });
});
