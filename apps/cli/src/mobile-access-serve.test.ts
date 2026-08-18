import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostServerMessage } from '@piwin/contracts';
import { interceptSidecarMobileAccess } from './mobile-access-serve.js';
import type { MobileAccessController } from '@piwin/host-server';

describe('interceptSidecarMobileAccess', () => {
  it('lets HostCommands through and never calls the controller', async () => {
    const handle = vi.fn();
    const send = vi.fn<(message: HostServerMessage) => Promise<void>>(async () => undefined);
    const handled = await interceptSidecarMobileAccess(
      { handle } as unknown as MobileAccessController,
      { type: 'host/status' },
      send,
    );
    expect(handled).toBe(false);
    expect(handle).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('answers mobile-access commands locally', async () => {
    const handle = vi.fn(async (command: { type: string }) => ({
      type: 'response' as const,
      command: command.type,
      success: true as const,
      data: { listening: false, pairedDeviceCount: 0 },
    }));
    const sent: HostServerMessage[] = [];
    const handled = await interceptSidecarMobileAccess(
      { handle } as unknown as MobileAccessController,
      { type: 'mobile-access/status' } as unknown as HostCommand,
      async (message) => {
        sent.push(message);
      },
    );
    expect(handled).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([
      {
        type: 'response',
        command: 'mobile-access/status',
        success: true,
        data: { listening: false, pairedDeviceCount: 0 },
      },
    ]);
  });
});
