import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { get } from 'node:http';
import { join } from 'node:path';
import { formatRelayEnrollmentLine, relaySigningPublicKey } from '@piwin/host-transport';
import { afterEach, describe, expect, it } from 'vitest';
import { runRelayAdminCommand } from './relay-admin-cli.js';
import { parseRelayArgs } from './relay-cli-args.js';
import { createTestIdentity, startTestRelay, waitFor } from './relay-harness.fixture.js';
import { loadRelayRegistry, saveRelayRegistry } from './relay-registry-store.js';
import { watchRelayRegistry } from './relay-registry-watch.js';
import { RelayUserRegistry } from './relay-user-registry.js';

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'piwin-relay-admin-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function admin(usersPath: string, argv: string[]): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const code = await runRelayAdminCommand(parseRelayArgs(argv), {
    usersPath,
    out: (line) => out.push(line),
  });
  return { code, out };
}

describe('relay admin CLI', () => {
  it('adds a user from an enrollment line, lists, disables, enables and removes it', async () => {
    const usersPath = join(await tempDir(), 'users.json');
    const identity = createTestIdentity();
    const line = formatRelayEnrollmentLine({
      publicKey: relaySigningPublicKey(identity.userSecretKey),
      name: 'Yorick',
    });

    expect((await admin(usersPath, ['user', 'add', line, '--max-hosts', '3'])).code).toBe(0);
    expect((await loadRelayRegistry(usersPath)).users[0]).toMatchObject({
      userId: identity.userId,
      name: 'Yorick',
      limits: { maxHosts: 3 },
    });
    expect((await admin(usersPath, ['user', 'add', line])).out[0]).toContain('already registered');

    const listed = await admin(usersPath, ['user', 'list']);
    expect(listed.out[0]).toContain(identity.userId);
    expect(listed.out[0]).toContain('enabled');

    await admin(usersPath, ['user', 'disable', identity.userId]);
    expect((await loadRelayRegistry(usersPath)).users[0]?.disabled).toBe(true);
    await admin(usersPath, ['user', 'enable', identity.userId]);
    expect((await loadRelayRegistry(usersPath)).users[0]?.disabled).toBe(false);
    expect((await admin(usersPath, ['user', 'remove', identity.userId])).code).toBe(0);
    expect((await loadRelayRegistry(usersPath)).users).toEqual([]);
    expect((await admin(usersPath, ['user', 'remove', identity.userId])).code).toBe(1);
  });

  it('denies and allows hosts', async () => {
    const usersPath = join(await tempDir(), 'users.json');
    const { hostId } = createTestIdentity();
    await admin(usersPath, ['host', 'deny', hostId]);
    expect((await loadRelayRegistry(usersPath)).deniedHosts).toEqual([hostId]);
    await admin(usersPath, ['host', 'allow', hostId]);
    expect((await loadRelayRegistry(usersPath)).deniedHosts).toEqual([]);
  });

  it('rejects bad input with exit code 1 and leaves the file alone', async () => {
    const usersPath = join(await tempDir(), 'users.json');
    for (const argv of [
      ['user', 'add', 'not-a-line'],
      ['user', 'disable', 'short'],
      ['host', 'deny', 'short'],
      ['frobnicate'],
    ]) {
      expect((await admin(usersPath, argv)).code).toBe(1);
    }
    await expect(readFile(usersPath)).rejects.toThrow();
  });
});

describe('watchRelayRegistry', () => {
  it('reloads edits and keeps the last good registry on a broken file', async () => {
    const usersPath = join(await tempDir(), 'users.json');
    const identity = createTestIdentity();
    const registry = new RelayUserRegistry();
    let reloads = 0;
    const errors: string[] = [];
    const stop = watchRelayRegistry({
      path: usersPath,
      registry,
      onReloaded: () => {
        reloads += 1;
      },
      log: (event) => {
        if (event.kind === 'registry-error') errors.push(event.detail);
      },
      intervalMs: 20,
    });
    try {
      const writer = new RelayUserRegistry();
      writer.addUser({
        userId: identity.userId,
        publicKey: identity.userPublicKey,
        name: 'Yorick',
      });
      await saveRelayRegistry(usersPath, writer.snapshot());
      await waitFor(() => (registry.find(identity.userId) ? true : undefined));
      expect(reloads).toBeGreaterThan(0);

      await writeFile(usersPath, '{ broken');
      await waitFor(() => (errors.length > 0 ? true : undefined));
      expect(registry.find(identity.userId)).toBeDefined();
    } finally {
      stop();
    }
  });
});

describe('relay static web root', () => {
  it('serves files, falls back to index.html and blocks traversal', async () => {
    const root = join(await tempDir(), 'web');
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<!doctype html><title>piwin</title>');
    await writeFile(join(root, 'assets', 'app.js'), 'console.log(1)');
    await writeFile(join(root, '..', 'secret.txt'), 'secret');
    const relay = await startTestRelay({ webRoot: root });
    try {
      const base = relay.url.replace('ws://', 'http://');
      const index = await fetch(`${base}/`);
      expect(index.headers.get('content-type')).toContain('text/html');
      expect(index.headers.get('x-content-type-options')).toBe('nosniff');
      expect(await index.text()).toContain('piwin');
      expect((await fetch(`${base}/assets/app.js`)).headers.get('content-type')).toContain(
        'javascript',
      );
      expect(await (await fetch(`${base}/some/route`)).text()).toContain('piwin');
      // fetch normalizes `..` and `%2e%2e` away; an encoded slash survives to the server.
      for (const path of ['/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt']) {
        const raw = await rawGet(base, path);
        expect(raw.status).toBe(403);
        expect(raw.body).not.toContain('secret');
      }
      expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
    } finally {
      await relay.close();
    }
  });
});

function rawGet(base: string, path: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    get({ hostname, port, path }, (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}
