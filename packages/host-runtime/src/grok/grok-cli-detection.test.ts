import { describe, expect, it } from 'vitest';
import { createFakeLineTransport } from '@piwin/acp-agent/testing';
import {
  detectGrokCli,
  GROK_VERIFIED_VERSIONS,
  resolveGrokBinaryCandidates,
} from './grok-cli-detection.js';

const CHECKED_AT = '2026-09-30T02:10:00.000Z';

async function waitForSent(
  transport: ReturnType<typeof createFakeLineTransport>,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (transport.sent.length > 0) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('initialize was not sent');
}

function parseSent(line: string | undefined): Record<string, unknown> {
  expect(line).toBeTypeOf('string');
  if (typeof line !== 'string') {
    throw new Error('expected sent line');
  }
  return JSON.parse(line) as Record<string, unknown>;
}

function deliverInitialize(
  transport: ReturnType<typeof createFakeLineTransport>,
  result: unknown,
): void {
  const sent = parseSent(transport.sent.at(-1));
  expect(sent.method).toBe('initialize');
  expect(sent.params).toEqual({
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'piwin', version: '0' },
  });
  transport.deliver(
    JSON.stringify({ jsonrpc: '2.0', id: sent.id, result }),
  );
}

describe('resolveGrokBinaryCandidates', () => {
  it('orders PIWIN_GROK_BIN, PATH entries, and ~/.grok/bin/grok without duplicates', () => {
    expect(
      resolveGrokBinaryCandidates(
        {
          PIWIN_GROK_BIN: '/custom/grok',
          PATH: '/usr/bin:/opt/bin:/usr/bin',
        },
        '/home/user',
        'darwin',
      ),
    ).toEqual(['/custom/grok', '/usr/bin/grok', '/opt/bin/grok', '/home/user/.grok/bin/grok']);
  });

  it('uses grok.exe and semicolon PATH on win32', () => {
    expect(
      resolveGrokBinaryCandidates(
        {
          PIWIN_GROK_BIN: 'C:\\tools\\grok.exe',
          PATH: 'C:\\Windows\\System32;D:\\bin',
        },
        'C:\\Users\\me',
        'win32',
      ),
    ).toEqual([
      'C:\\tools\\grok.exe',
      'C:\\Windows\\System32\\grok.exe',
      'D:\\bin\\grok.exe',
      'C:\\Users\\me\\.grok\\bin\\grok',
    ]);
  });
});

describe('detectGrokCli', () => {
  it('returns not-installed when no candidate exists', async () => {
    const status = await detectGrokCli({
      env: { PATH: '/usr/bin' },
      homeDir: '/home/user',
      platform: 'linux',
      fileExists: async () => false,
      now: () => CHECKED_AT,
    });
    expect(status).toEqual({
      agentId: 'grok',
      state: 'not-installed',
      searched: ['/usr/bin/grok', '/home/user/.grok/bin/grok'],
      checkedAt: CHECKED_AT,
    });
  });

  it('returns ready+verified for 1.0.44 with cached_token', async () => {
    const transport = createFakeLineTransport();
    const detection = detectGrokCli({
      env: { PATH: '/usr/bin' },
      homeDir: '/home/user',
      platform: 'linux',
      fileExists: async (path) => path === '/usr/bin/grok',
      createTransport: () => transport,
      now: () => CHECKED_AT,
    });
    await waitForSent(transport);
    deliverInitialize(transport, {
      protocolVersion: 1,
      authMethods: [{ id: 'cached_token' }],
      _meta: { agentVersion: '1.0.44', defaultAuthMethodId: 'cached_token' },
    });
    await expect(detection).resolves.toEqual({
      agentId: 'grok',
      state: 'ready',
      binaryPath: '/usr/bin/grok',
      version: '1.0.44',
      supportStatus: 'verified',
      defaultAuthMethodId: 'cached_token',
      checkedAt: CHECKED_AT,
    });
    expect(GROK_VERIFIED_VERSIONS.has('1.0.44')).toBe(true);
  });

  it('marks unknown versions unverified', async () => {
    const transport = createFakeLineTransport();
    const detection = detectGrokCli({
      env: { PATH: '/usr/bin' },
      homeDir: '/home/user',
      platform: 'linux',
      fileExists: async () => true,
      createTransport: () => transport,
      now: () => CHECKED_AT,
    });
    await waitForSent(transport);
    deliverInitialize(transport, {
      protocolVersion: 1,
      _meta: { agentVersion: '9.9.9', defaultAuthMethodId: 'cached_token' },
    });
    await expect(detection).resolves.toMatchObject({
      state: 'ready',
      version: '9.9.9',
      supportStatus: 'unverified',
    });
  });

  it('returns unauthenticated when defaultAuthMethodId is grok.com', async () => {
    const transport = createFakeLineTransport();
    const detection = detectGrokCli({
      env: { PATH: '/usr/bin' },
      homeDir: '/home/user',
      platform: 'linux',
      fileExists: async () => true,
      createTransport: () => transport,
      now: () => CHECKED_AT,
    });
    await waitForSent(transport);
    deliverInitialize(transport, {
      protocolVersion: 1,
      authMethods: [{ id: 'grok.com' }],
      _meta: { agentVersion: '1.0.41', defaultAuthMethodId: 'grok.com' },
    });
    await expect(detection).resolves.toEqual({
      agentId: 'grok',
      state: 'unauthenticated',
      binaryPath: '/usr/bin/grok',
      version: '1.0.41',
      supportStatus: 'verified',
      defaultAuthMethodId: 'grok.com',
      checkedAt: CHECKED_AT,
    });
  });

  it('returns unavailable when initialize fails and omits stderr', async () => {
    const transport = createFakeLineTransport();
    const detection = detectGrokCli({
      env: { PATH: '/usr/bin' },
      homeDir: '/home/user',
      platform: 'linux',
      fileExists: async () => true,
      createTransport: () => transport,
      now: () => CHECKED_AT,
    });
    await waitForSent(transport);
    const sent = parseSent(transport.sent.at(-1));
    transport.deliver(
      JSON.stringify({
        jsonrpc: '2.0',
        id: sent.id,
        error: { code: -32000, message: 'handshake failed', data: { stderr: 'XAI_API_KEY=sk-secret' } },
      }),
    );
    const status = await detection;
    expect(status.state).toBe('unavailable');
    if (status.state !== 'unavailable') {
      throw new Error('expected unavailable');
    }
    expect(status.binaryPath).toBe('/usr/bin/grok');
    expect(status.reason).toContain('AcpRpcError');
    expect(status.reason).not.toContain('sk-secret');
    expect(status.reason).not.toContain('XAI_API_KEY');
    expect(JSON.stringify(status)).not.toContain('sk-secret');
  });

  it('returns unavailable when agent omits a version', async () => {
    const transport = createFakeLineTransport();
    const detection = detectGrokCli({
      env: { PATH: '/usr/bin' },
      homeDir: '/home/user',
      platform: 'linux',
      fileExists: async () => true,
      createTransport: () => transport,
      now: () => CHECKED_AT,
    });
    await waitForSent(transport);
    deliverInitialize(transport, {
      protocolVersion: 1,
      _meta: { defaultAuthMethodId: 'cached_token' },
    });
    await expect(detection).resolves.toEqual({
      agentId: 'grok',
      state: 'unavailable',
      binaryPath: '/usr/bin/grok',
      reason: 'agent did not report a version',
      checkedAt: CHECKED_AT,
    });
  });
});
