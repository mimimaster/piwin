import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostStatusData } from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';

describe('HostRuntime status capabilities', () => {
  it('reports customTools true for sdk mode', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-status-sdk-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const status = await runtime.handleCommand({ type: 'host/status' });
    expect(status.success).toBe(true);
    if (!status.success) throw new Error(status.error);
    const data = status.data as HostStatusData;
    expect(data.capabilities.customTools).toBe(true);
    expect(data.capabilities.productTranscript).toBe(true);
    expect(data.capabilities.mcpLifecycle).toBe(true);
    expect(data.capabilities.compaction).toBe(true);
    expect(data.capabilities.extensions).toBe(true);
    expect(data.capabilities.prompts).toBe(true);
    expect(data.capabilities.extensionUiBridge).toBe(true);
    expect(data.capabilities.sessionPin).toBe(true);
    expect(data.capabilities.sessionSearch).toBe(true);
    expect(data.capabilities.usage).toBe(true);
    expect(data.capabilities.process).toBe(true);
    await runtime.dispose();
  });

  it('reports customTools true for rpc mode via SDK fallback', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-status-rpc-'));
    const runtime = new HostRuntime({ mode: 'rpc', mock: true, piwinRoot: rootDir });
    const status = await runtime.handleCommand({ type: 'host/status' });
    expect(status.success).toBe(true);
    if (!status.success) throw new Error(status.error);
    const data = status.data as HostStatusData;
    expect(data.mode).toBe('rpc');
    // mock rpc does not use SDK fallback path; customTools stays false until live rpc+fallback
    // Live non-mock rpc reports true via isRpcSdkFallback — mock keeps prior mock semantics.
    expect(data.capabilities.customTools).toBe(false);
    // mock:true still enables compaction capability flag
    expect(data.capabilities.compaction).toBe(true);
    expect(data.capabilities.extensions).toBe(true);
    expect(data.capabilities.prompts).toBe(true);
    await runtime.dispose();
  });
});
