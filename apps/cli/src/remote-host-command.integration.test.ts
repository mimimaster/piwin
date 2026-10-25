import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostCommand, HostResponse, PushSink } from '@piwin/contracts';
import {
  HostDevicePairing,
  HostServer,
  openHostRemoteAccessAtRoot,
  type HostRemoteAccess,
  type HostRuntimePort,
} from '@piwin/host-server';
import { afterEach, describe, expect, it } from 'vitest';
import { connectCliAttachedHost, resolveCliHostAttachTarget } from './attach-existing-host.js';
import { migrateLegacyCliTarget } from './cli-remote-attach.js';
import { openCliRemoteHosts } from './cli-remote-hosts.js';
import { commandRelay } from './relay-command.js';
import { commandHosts, commandPair } from './remote-host-command.js';

class FakeRuntime implements HostRuntimePort {
  public async handleCommand(command: HostCommand): Promise<HostResponse> {
    return { type: 'response', command: command.type, success: true, data: { ok: true } };
  }
  public attachPushSink(_sink: PushSink): () => void {
    return () => undefined;
  }
  public attachBrowserFrameSink(_sink: unknown): () => void {
    return () => undefined;
  }
}

type Fixture = {
  hostRoot: string;
  cliRoot: string;
  pairing: HostDevicePairing;
  access: HostRemoteAccess;
  server: HostServer;
  url: string;
  link: (role?: 'member' | 'operator') => string;
};

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(): Promise<Fixture> {
  const hostRoot = await mkdtemp(join(tmpdir(), 'piwin-cli-host-'));
  const cliRoot = await mkdtemp(join(tmpdir(), 'piwin-cli-client-'));
  cleanups.push(() => rm(hostRoot, { recursive: true, force: true, maxRetries: 3 }));
  cleanups.push(() => rm(cliRoot, { recursive: true, force: true, maxRetries: 3 }));
  const pairing = new HostDevicePairing();
  const access = await openHostRemoteAccessAtRoot({
    piwinRoot: hostRoot,
    pairing,
    hostName: 'Server',
    defaultUserName: 'owner',
  });
  const server = new HostServer({
    runtime: new FakeRuntime(),
    host: '127.0.0.1',
    port: 0,
    devicePairing: pairing,
    remoteAccess: access,
  });
  const { url } = await server.start();
  access.start();
  cleanups.push(async () => {
    access.dispose();
    await server.stop();
  });
  return {
    hostRoot,
    cliRoot,
    pairing,
    access,
    server,
    url,
    link: (role = 'member') => {
      const minted = pairing.mintToken(role);
      const links = access.channelLinks({
        pairingToken: minted.token,
        expiresAt: minted.expiresAt,
        role,
      });
      if (links === undefined) throw new Error('no channel path');
      return links.channelUri;
    },
  };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) },
  };
}

describe('piwin pair / hosts / relay against a real Host (ADR 0101 P5)', () => {
  it('pairs, stores owner-only state, and attaches with PIWIN_HOST', async () => {
    const f = await fixture();
    const paired = capture();
    expect(
      await commandPair(['pair', f.link(), '--alias', 'server'], {
        ...paired.io,
        piwinRoot: f.cliRoot,
      }),
    ).toBe(0);
    expect(paired.out[0]).toContain('Paired with Server (owner) as member');

    const clientDir = join(f.cliRoot, 'client');
    expect((await stat(join(clientDir, 'piwin.host-book.v1.json'))).mode & 0o777).toBe(0o600);
    expect(await readdir(join(clientDir, 'hosts'))).toHaveLength(1);

    const target = await resolveCliHostAttachTarget({ PIWIN_HOST: 'server' }, f.cliRoot);
    if (target === undefined) throw new Error('no target');
    const client = await connectCliAttachedHost(target, f.cliRoot);
    expect(await client.request({ type: 'session/list' } as never)).toMatchObject({
      success: true,
    });
    await client.close();

    const listed = capture();
    await commandHosts(['hosts', 'list'], { ...listed.io, piwinRoot: f.cliRoot });
    expect(listed.out.join('\n')).toMatch(/Server "server" .* member {2}direct/);
  });

  it('refuses an older pairing code with a clear message', async () => {
    const result = capture();
    expect(
      await commandPair(
        ['pair', 'piwin://pair?endpoint=ws%3A%2F%2F10.0.0.2%3A8790&pairingToken=x'],
        result.io,
      ),
    ).toBe(1);
    expect(result.err[0]).toContain('older pairing code');
  });

  it('mints operator codes only for an operator device and reports relay status', async () => {
    const f = await fixture();
    // Two installations: one CLI keeps one entry per Host.
    const operatorRoot = await mkdtemp(join(tmpdir(), 'piwin-cli-operator-'));
    cleanups.push(() => rm(operatorRoot, { recursive: true, force: true, maxRetries: 3 }));
    await commandPair(['pair', f.link('member'), '--alias', 'server'], {
      ...capture().io,
      piwinRoot: f.cliRoot,
    });
    await commandPair(['pair', f.link('operator'), '--alias', 'server'], {
      ...capture().io,
      piwinRoot: operatorRoot,
    });
    const env = { PIWIN_HOST: 'server' };

    const asMember = capture();
    expect(
      await commandRelay(['host', 'pair', '--operator'], {
        ...asMember.io,
        piwinRoot: f.cliRoot,
        env,
      }),
    ).toBe(1);

    const asOperator = capture();
    expect(
      await commandRelay(['host', 'pair', '--operator'], {
        ...asOperator.io,
        piwinRoot: operatorRoot,
        env,
      }),
    ).toBe(0);
    expect(asOperator.out.join('\n')).toMatch(/piwin:\/\/pair\?v=3.*role=operator/);

    const status = capture();
    expect(
      await commandRelay(['relay', 'status'], { ...status.io, piwinRoot: operatorRoot, env }),
    ).toBe(0);
    expect(status.out.join('\n')).toContain('Host:   Server');
    expect(status.out.join('\n')).toContain('Legacy: full');

    const line = capture();
    await commandRelay(['relay', 'user', 'enrollment-line'], {
      ...line.io,
      piwinRoot: operatorRoot,
      env,
    });
    expect(line.out[0]).toMatch(/^piwin-user:v1:/);
  });

  it('needs an attached Host for Host-owned commands', async () => {
    const f = await fixture();
    const result = capture();
    expect(
      await commandRelay(['relay', 'status'], { ...result.io, piwinRoot: f.cliRoot, env: {} }),
    ).toBe(1);
    expect(result.err[0]).toContain('No Host is attached');
  });

  it('migrates legacy env credentials once and reuses the mapping', async () => {
    const f = await fixture();
    const { credential } = f.pairing.completePairing(f.pairing.mintToken().token, 'Old CLI');
    const hosts = openCliRemoteHosts(f.cliRoot);
    const logs: string[] = [];
    const first = await migrateLegacyCliTarget({
      hosts,
      endpoint: f.url,
      clientId: 'cli-legacy',
      credential,
      log: (line) => logs.push(line),
    });
    expect(first?.remoteHost.entry.hostName).toBe('Server');
    expect(logs[0]).toContain('migrated');
    expect(f.pairing.list()[0]?.migratedAt).toBeDefined();

    const second = await migrateLegacyCliTarget({
      hosts,
      endpoint: f.url,
      clientId: 'cli-legacy',
      credential,
      log: (line) => logs.push(line),
    });
    expect(second?.remoteHost.entry.hostId).toBe(first?.remoteHost.entry.hostId);
    expect(logs).toHaveLength(1);
  });

  it('uses a default Host and forgets it cleanly', async () => {
    const f = await fixture();
    await commandPair(['pair', f.link(), '--alias', 'server'], {
      ...capture().io,
      piwinRoot: f.cliRoot,
    });
    await commandHosts(['hosts', 'use', 'server'], { ...capture().io, piwinRoot: f.cliRoot });
    const target = await resolveCliHostAttachTarget({}, f.cliRoot);
    expect(target).toHaveProperty('remoteHost.entry.alias', 'server');

    await commandHosts(['hosts', 'forget', 'server'], { ...capture().io, piwinRoot: f.cliRoot });
    expect(await resolveCliHostAttachTarget({}, f.cliRoot)).toBeUndefined();
    expect(await readdir(join(f.cliRoot, 'client', 'hosts'))).toEqual([]);
  });
});
