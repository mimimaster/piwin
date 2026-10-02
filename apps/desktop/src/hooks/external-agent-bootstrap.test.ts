import { describe, expect, it, vi } from 'vitest';
import type { ExternalAgentStatus } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import {
  bootstrapExternalAgents,
  handleExternalAgentPush,
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

  it('passes refresh: true when requested', async () => {
    const agents = [readyAgent()];
    const dispatch = vi.fn();
    const request = vi.fn().mockResolvedValue({ success: true, data: { agents } });
    const hostClient = { request } as unknown as HostClient;

    const result = await bootstrapExternalAgents(hostClient, dispatch, { refresh: true });

    expect(request).toHaveBeenCalledWith({ type: 'agents/status', refresh: true });
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

describe('handleExternalAgentPush', () => {
  it('automatically checks backends after an ordinary extension install or toggle', async () => {
    const agents = [readyAgent()];
    const dispatch = vi.fn();
    const request = vi.fn().mockResolvedValue({ success: true, data: { agents } });
    const hostClient = { request } as unknown as HostClient;
    expect(handleExternalAgentPush(hostClient, dispatch, {
      type: 'marketplace/inventory-updated', revision: 'enabled', changedKinds: ['extension'],
    })).toBe(true);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'agents/set-all', agents }));
    expect(request).toHaveBeenCalledWith({ type: 'agents/status', refresh: true });
  });

  it('clears the backend statuses after the last backend is uninstalled', async () => {
    const dispatch = vi.fn();
    const hostClient = {
      request: vi.fn().mockResolvedValue({ success: true, data: { agents: [] } }),
    } as unknown as HostClient;
    handleExternalAgentPush(hostClient, dispatch, {
      type: 'marketplace/inventory-updated', revision: 'removed', changedKinds: ['extension'],
    });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'agents/set-all', agents: [] }));
  });

  it('syncs the native catalog on a ready status push', () => {
    const status = readyAgent();
    const dispatch = vi.fn();
    const request = vi.fn().mockResolvedValue({ success: true });
    const hostClient = { request } as unknown as HostClient;
    expect(handleExternalAgentPush(hostClient, dispatch, { type: 'agents/status-updated', status })).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'agents/status-updated', status });
    expect(request).toHaveBeenCalledWith({ type: 'agents/sessions-sync', agentId: status.agentId });
  });

  it('does not launch backend checks for unrelated inventory updates', () => {
    const request = vi.fn();
    const hostClient = { request } as unknown as HostClient;
    expect(handleExternalAgentPush(hostClient, vi.fn(), {
      type: 'marketplace/inventory-updated', revision: 'skill', changedKinds: ['skill'],
    })).toBe(false);
    expect(request).not.toHaveBeenCalled();
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
