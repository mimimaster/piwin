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

  it('routes ADR 0101 remote-access commands to the controller and refuses bad payloads', async () => {
    const handleRemoteAccess = vi.fn(async (command: { type: string }) => ({
      type: 'response' as const,
      command: command.type,
      success: true as const,
      data: { ok: true },
    }));
    const sent: HostServerMessage[] = [];
    const controller = { handleRemoteAccess } as unknown as MobileAccessController;
    const record = async (message: HostServerMessage): Promise<void> => {
      sent.push(message);
    };
    expect(
      await interceptSidecarMobileAccess(
        controller,
        { type: 'host/relay-user-enrollment-line' },
        record,
      ),
    ).toBe(true);
    expect(
      await interceptSidecarMobileAccess(
        controller,
        { type: 'host/relay-user-create' } as unknown as HostCommand,
        record,
      ),
    ).toBe(true);
    expect(handleRemoteAccess).toHaveBeenCalledTimes(1);
    expect(sent[1]).toMatchObject({ success: false });
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
