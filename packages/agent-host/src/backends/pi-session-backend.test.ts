/**
 * WP5 tests: PiSessionBackend interface + backend mode/isolation reporting.
 *
 * Tests that:
 * - InProcessSdkSessionBackend reports mode='sdk', isolated=false
 * - WorkerRpcSessionBackend reports mode='rpc-worker', isolated=true
 * - PiRpcAdapter.usesWorkerBackend / isIsolated / backendMode honor flags
 * - preparePromptInput strips empty attachments
 */

import { describe, expect, it, vi } from 'vitest';
import { preparePromptInput } from './pi-session-backend.js';
import { InProcessSdkSessionBackend } from './in-process-sdk-session-backend.js';
import { WorkerRpcSessionBackend } from './worker-rpc-session-backend.js';
import { PiRpcAdapter } from '../rpc-adapter.js';

describe('preparePromptInput', () => {
  it('returns text-only prepared prompt when no attachments', async () => {
    const prepared = await preparePromptInput({ text: 'hello' }, {});
    expect(prepared.text).toBe('hello');
    expect(prepared.images).toBeUndefined();
  });

  it('loads images when attachments are present', async () => {
    const loadImages = vi.fn(async () => [{ data: 'AAAA', mimeType: 'image/png' }]);
    const prepared = await preparePromptInput(
      { text: 'describe', attachments: [{ kind: 'image', path: '/tmp/x.png' }] as never },
      { loadImages },
    );
    expect(prepared.images).toEqual([{ data: 'AAAA', mimeType: 'image/png' }]);
    expect(loadImages).toHaveBeenCalledOnce();
  });

  it('preserves streamingBehavior and model', async () => {
    const prepared = await preparePromptInput(
      {
        text: 'go',
        streamingBehavior: 'steer',
        model: { protocol: 'openai-compatible', providerId: 'p1', modelId: 'm1' },
        thinkingLevel: 'high',
      },
      {},
    );
    expect(prepared.streamingBehavior).toBe('steer');
    expect(prepared.model).toEqual({
      protocol: 'openai-compatible',
      providerId: 'p1',
      modelId: 'm1',
    });
    expect(prepared.thinkingLevel).toBe('high');
  });
});

describe('InProcessSdkSessionBackend', () => {
  it('reports mode=sdk, isolated=false', () => {
    const fakeAdapter = {
      createSession: vi.fn(),
      dropSession: vi.fn(),
      dispose: vi.fn(),
    } as unknown as import('../sdk-adapter.js').PiSdkAdapter;
    const backend = new InProcessSdkSessionBackend({
      createAdapter: () => fakeAdapter,
      adapterOptions: { mock: false },
    });
    expect(backend.mode).toBe('sdk');
    expect(backend.isolated).toBe(false);
  });
});

describe('WorkerRpcSessionBackend', () => {
  it('reports mode=rpc-worker, isolated=true', () => {
    const backend = new WorkerRpcSessionBackend({
      worker: { workerScript: '/tmp/fake.ts' },
    });
    expect(backend.mode).toBe('rpc-worker');
    expect(backend.isolated).toBe(true);
  });
});

describe('PiRpcAdapter backend mode reporting', () => {
  it('defaults to rpc-fallback when no flags set', () => {
    const adapter = new PiRpcAdapter({ command: 'pi' });
    expect(adapter.backendMode()).toBe('rpc-fallback');
    expect(adapter.usesWorkerBackend()).toBe(false);
    expect(adapter.isIsolated()).toBe(false);
  });

  it('uses worker backend when useWorkerBackend=true', () => {
    const adapter = new PiRpcAdapter({ command: 'pi', useWorkerBackend: true });
    expect(adapter.backendMode()).toBe('rpc-worker');
    expect(adapter.usesWorkerBackend()).toBe(true);
    expect(adapter.isIsolated()).toBe(true);
    expect(adapter.usesSdkFallback()).toBe(false);
  });

  it('uses worker backend when PIWIN_RPC_WORKER=1', () => {
    process.env.PIWIN_RPC_WORKER = '1';
    try {
      const adapter = new PiRpcAdapter({ command: 'pi' });
      expect(adapter.backendMode()).toBe('rpc-worker');
      expect(adapter.isIsolated()).toBe(true);
    } finally {
      delete process.env.PIWIN_RPC_WORKER;
    }
  });

  it('PIWIN_RPC_SDK_FALLBACK=1 forces SDK fallback even when worker enabled (§10.1)', () => {
    process.env.PIWIN_RPC_WORKER = '1';
    process.env.PIWIN_RPC_SDK_FALLBACK = '1';
    try {
      const adapter = new PiRpcAdapter({ command: 'pi', useWorkerBackend: true });
      expect(adapter.usesWorkerBackend()).toBe(false);
      expect(adapter.isIsolated()).toBe(false);
      expect(adapter.backendMode()).toBe('rpc-fallback');
    } finally {
      delete process.env.PIWIN_RPC_WORKER;
      delete process.env.PIWIN_RPC_SDK_FALLBACK;
    }
  });

  it('reports mock mode when mock=true', () => {
    const adapter = new PiRpcAdapter({ command: 'pi', mock: true });
    expect(adapter.backendMode()).toBe('mock');
    expect(adapter.usesWorkerBackend()).toBe(false);
    expect(adapter.usesSdkFallback()).toBe(false);
  });

  it('uses sdk fallback when PIWIN_RPC_STOCK=1 (not worker)', () => {
    process.env.PIWIN_RPC_STOCK = '1';
    try {
      const adapter = new PiRpcAdapter({ command: 'pi' });
      expect(adapter.usesSdkFallback()).toBe(false);
      expect(adapter.backendMode()).toBe('sdk');
    } finally {
      delete process.env.PIWIN_RPC_STOCK;
    }
  });
});
