import { describe, expect, it, vi } from 'vitest';
import type { ExternalAgentStatus } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import {
  bootstrapExternalAgents,
  syncReadyAgentCatalogs,
} from './external-agent-bootstrap';
import { notInstalledAgent, readyAgent } from '../test/fixtures/agent-backend-state.fixtures';

describe('bootstrapExternalAgents', () => {
  it('dispatches the discovered agents and returns them', async () => {
    const agents = [readyAgent()];
    const dispatch = vi.fn();
    const request = vi.fn().mockResolvedValue({ success: true, data: { agents } });
    const hostClient = { request } as unknown as HostClient;

    const result = await bootstrapExternalAgents(hostClient, dispatch);

    expect(request).toHaveBeenCalledWith({ type: 'agents/status' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'agents/set-all', agents });
    expect(result).toEqual(agents);
  });

  it('is a no-op when the request fails or the payload is malformed', async () => {
    const dispatch = vi.fn();
    const failing = {
      request: vi.fn().mockResolvedValue({ success: false, error: 'nope' }),
    } as unknown as HostClient;
    expect(await bootstrapExternalAgents(failing, dispatch)).toEqual([]);

    const malformed = {
      request: vi.fn().mockResolvedValue({ success: true, data: {} }),
    } as unknown as HostClient;
    expect(await bootstrapExternalAgents(malformed, dispatch)).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('swallows transport throws rather than rejecting the bootstrap', async () => {
    const dispatch = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const throwing = {
      request: vi.fn().mockRejectedValue(new Error('offline')),
    } as unknown as HostClient;

    await expect(bootstrapExternalAgents(throwing, dispatch)).resolves.toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('syncReadyAgentCatalogs', () => {
  it('syncs only ready agents', () => {
    const request = vi.fn().mockResolvedValue({ success: true });
    const hostClient = { request } as unknown as HostClient;

    syncReadyAgentCatalogs(hostClient, [notInstalledAgent('grok'), readyAgent('other')]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ type: 'agents/sessions-sync', agentId: 'other' });
  });

  it('does not throw when the catalog sync fails', () => {
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    const hostClient = { request } as unknown as HostClient;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => syncReadyAgentCatalogs(hostClient, [readyAgent()])).not.toThrow();
    consoleError.mockRestore();
  });
});

describe('external agent status fixtures', () => {
  it('are structurally valid ExternalAgentStatus values', () => {
    const values: ExternalAgentStatus[] = [readyAgent(), notInstalledAgent()];
    expect(values).toHaveLength(2);
  });
});
