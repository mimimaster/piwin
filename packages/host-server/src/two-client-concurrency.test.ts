import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  HostCommand,
  HostPush,
  HostResponse,
  SettingsSnapshot,
} from '@piwin/contracts';
import { HostClient } from '@piwin/host-client';
import { HostRuntime } from '@piwin/host-runtime';
import { WebSocketHostTransport, type WebSocketLike } from '@piwin/host-transport';
import { WebSocket } from 'ws';
import { HostServer } from './host-server.js';

function createNodeWebSocket(endpoint: string): WebSocketLike {
  const socket = new WebSocket(endpoint);
  const wrapper: WebSocketLike = {
    get readyState() {
      return socket.readyState;
    },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) {
      socket.send(data);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
  };
  socket.on('open', () => {
    wrapper.onopen?.();
  });
  socket.on('message', (data) => {
    wrapper.onmessage?.({ data: String(data) });
  });
  socket.on('error', (error) => {
    wrapper.onerror?.(error);
  });
  socket.on('close', (code, reason) => {
    wrapper.onclose?.({ code, reason: String(reason) });
  });
  return wrapper;
}

type TestClient = {
  id: string;
  client: HostClient;
  pushes: HostPush[];
};

async function connectClient(url: string, clientId: string): Promise<TestClient> {
  const transport = new WebSocketHostTransport({
    endpoint: url,
    autoReconnect: false,
    webSocketFactory: createNodeWebSocket,
  });
  const client = new HostClient({
    transport,
    clientId,
    clientType: 'desktop',
    clientVersion: 'test',
    capabilities: {
      pushBatching: true,
      cursorBatches: true,
      boundedReplay: true,
      hydration: false,
    },
    requestTimeoutMs: 15_000,
  });
  const pushes: HostPush[] = [];
  client.subscribePush((push) => {
    pushes.push(push);
  });
  await client.connect();
  return { id: clientId, client, pushes };
}

function requireSuccess(response: HostResponse, label: string): HostResponse & { success: true } {
  if (!response.success) {
    throw new Error(`${label} failed: ${response.error}`);
  }
  return response;
}

async function waitForPush(
  client: TestClient,
  predicate: (push: HostPush) => boolean,
): Promise<HostPush> {
  return vi.waitFor(() => {
    const found = client.pushes.find(predicate);
    if (found === undefined) {
      throw new Error(`Timed out waiting for push on ${client.id}`);
    }
    return found;
  });
}

describe('§15 two-client concurrency', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    const pending = cleanups.splice(0);
    for (const cleanup of pending.reverse()) {
      await cleanup();
    }
  });

  async function startHarness(options?: {
    hang?: boolean;
    rootOwnership?: boolean;
  }): Promise<{
    runtime: HostRuntime;
    server: HostServer;
    client1: TestClient;
    client2: TestClient;
    rootDir: string;
  }> {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-two-client-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      ...(options?.hang === false ? {} : { testFixture: 'hang-until-abort' }),
      ...(options?.rootOwnership === true
        ? { rootOwnership: { enabled: true, ownerKind: 'test' as const } }
        : {}),
    });
    const server = new HostServer({
      runtime,
      port: 0,
      instanceId: `two-client-${randomUUID()}`,
    });
    const address = await server.start();
    const client1 = await connectClient(address.url, 'client-1');
    const client2 = await connectClient(address.url, 'client-2');
    cleanups.push(async () => {
      await client1.client.close();
      await client2.client.close();
      await server.stop();
      await runtime.dispose();
    });
    return { runtime, server, client1, client2, rootDir };
  }

  async function createSession(client: TestClient, name: string): Promise<string> {
    const created = requireSuccess(
      await client.client.request(
        {
          type: 'session/create',
          input: { scope: { kind: 'general' }, sessionName: name },
        },
        { idempotencyKey: `create-${name}-${randomUUID()}` },
      ),
      'session/create',
    );
    return (created.data as { sessionId: string }).sessionId;
  }

  async function promptIfIdle(
    client: TestClient,
    sessionId: string,
    text: string,
    key: string = randomUUID(),
  ): Promise<HostResponse> {
    return client.client.request(
      {
        type: 'session/prompt',
        sessionId,
        input: { text },
        foreground: { kind: 'if-idle' },
      },
      { idempotencyKey: key },
    );
  }

  it('1. both clients see the same run and transcript append', async () => {
    const { client1, client2 } = await startHarness({ hang: false });
    const sessionId = await createSession(client1, 'shared');
    const prompted = requireSuccess(await promptIfIdle(client1, sessionId, 'hello'), 'prompt');
    const runId = (prompted.data as { runId: string }).runId;
    await waitForPush(
      client2,
      (push) => push.type === 'transcript/append' && push.sessionId === sessionId,
    );
    await waitForPush(
      client2,
      (push) => push.type === 'run/updated' && push.run.runId === runId,
    );
  });

  it('2. if-idle during a live run is active and does not start a second run', async () => {
    const { client1, client2 } = await startHarness();
    const sessionId = await createSession(client1, 'busy');
    const first = requireSuccess(await promptIfIdle(client1, sessionId, 'live'), 'first prompt');
    const runId = (first.data as { runId: string }).runId;
    const busy = await promptIfIdle(client2, sessionId, 'second');
    expect(busy.success).toBe(false);
    if (!busy.success) {
      expect(busy.problem).toMatchObject({
        code: 'foreground-run-mismatch',
        data: { reason: 'active', actualRun: { runId } },
      });
    }
  });

  it('3. queued-turn-submit drains to exactly one follow-on run', async () => {
    const { client1, client2 } = await startHarness();
    const sessionId = await createSession(client1, 'queue');
    const first = requireSuccess(await promptIfIdle(client1, sessionId, 'live'), 'first prompt');
    const runId = (first.data as { runId: string }).runId;
    const queued = requireSuccess(
      await client2.client.request(
        {
          type: 'session/queued-turn-submit',
          sessionId,
          queuedTurnId: randomUUID(),
          userMessageId: randomUUID(),
          input: { text: 'next' },
        },
        { idempotencyKey: randomUUID() },
      ),
      'queued-turn-submit',
    );
    expect((queued.data as { queuedTurn?: { status: string } }).queuedTurn?.status).toBe('pending');
    await waitForPush(client1, (push) => push.type === 'session/queued-turn-updated');
    requireSuccess(
      await client1.client.request(
        { type: 'session/abort', sessionId, runId },
        { idempotencyKey: randomUUID() },
      ),
      'abort',
    );
    await vi.waitFor(() => {
      const followOn = client1.pushes.filter(
        (push): push is Extract<HostPush, { type: 'run/updated' }> =>
          push.type === 'run/updated' && push.run.runId !== runId,
      );
      expect(followOn.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('4. concurrent if-idle admits one run and mismatches the other', async () => {
    const { client1, client2 } = await startHarness();
    const sessionId = await createSession(client1, 'race');
    const [first, second] = await Promise.all([
      promptIfIdle(client1, sessionId, 'a'),
      promptIfIdle(client2, sessionId, 'b'),
    ]);
    const accepted = [first, second].filter((response) => response.success);
    const rejected = [first, second].filter((response) => !response.success);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (!rejected[0]?.success) {
      expect(rejected[0]?.problem?.code).toBe('foreground-run-mismatch');
    }
  });

  it('5–6. concurrent replace-run admits one; wrong runId does not cancel', async () => {
    const { client1, client2 } = await startHarness();
    const sessionId = await createSession(client1, 'replace');
    const first = requireSuccess(await promptIfIdle(client1, sessionId, 'live'), 'first prompt');
    const runId = (first.data as { runId: string }).runId;
    const replace = (text: string, target: string): Promise<HostResponse> =>
      client1.client.request(
        {
          type: 'session/prompt',
          sessionId,
          input: { text },
          foreground: { kind: 'replace-run', runId: target },
        },
        { idempotencyKey: randomUUID() },
      );
    const wrong = await client2.client.request(
      {
        type: 'session/prompt',
        sessionId,
        input: { text: 'stale' },
        foreground: { kind: 'replace-run', runId: 'run-other' },
      },
      { idempotencyKey: randomUUID() },
    );
    expect(wrong.success).toBe(false);
    if (!wrong.success) {
      expect(wrong.problem).toMatchObject({
        code: 'foreground-run-mismatch',
        data: { reason: 'changed', actualRun: { runId } },
      });
    }
    const [left, right] = await Promise.all([replace('take-a', runId), replace('take-b', runId)]);
    const accepted = [left, right].filter((response) => response.success);
    const rejected = [left, right].filter((response) => !response.success);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (!rejected[0]?.success) {
      expect(['changed', 'transitioning']).toContain(
        (rejected[0]?.problem as { data?: { reason?: string } } | undefined)?.data?.reason,
      );
    }
    const still = requireSuccess(
      await client2.client.request({ type: 'session/foreground-run', sessionId }),
      'foreground after replace',
    );
    expect((still.data as { run?: { runId: string } | null }).run?.runId).toBeDefined();
  });

  it('7–8. non-overlapping settings rebase; overlapping thinking conflicts', async () => {
    const { client1, client2 } = await startHarness({ hang: false });
    const loaded = requireSuccess(await client1.client.request({ type: 'settings/get' }), 'get');
    const snapshot = (loaded.data as { snapshot: SettingsSnapshot }).snapshot;
    const thinkingHash = snapshot.domainRevisions.thinking;
    const webHash = snapshot.domainRevisions.web;
    expect(thinkingHash).toBeTruthy();
    expect(webHash).toBeTruthy();
    if (thinkingHash === undefined || webHash === undefined || snapshot.config.web === undefined) {
      throw new Error('missing domain hashes or web config');
    }
    const currentWeb = snapshot.config.web;
    const thinkingApply: HostCommand = {
      type: 'settings/apply',
      input: {
        expectedRevision: snapshot.revision,
        expectedDomainRevisions: { thinking: thinkingHash },
        mutations: [{ kind: 'replace-domain', domain: 'thinking', value: { ultraEnabled: true } }],
      },
    };
    const webApply: HostCommand = {
      type: 'settings/apply',
      input: {
        expectedRevision: snapshot.revision,
        expectedDomainRevisions: { web: webHash },
        mutations: [
          {
            kind: 'replace-domain',
            domain: 'web',
            value: { ...currentWeb, searchMaxResults: currentWeb.searchMaxResults + 1 },
          },
        ],
      },
    };
    const [thinking, web] = await Promise.all([
      client1.client.request(thinkingApply, { idempotencyKey: 'settings-thinking' }),
      client2.client.request(webApply, { idempotencyKey: 'settings-web' }),
    ]);
    if (!thinking.success) {
      throw new Error(`thinking apply failed: ${thinking.error}`);
    }
    if (!web.success) {
      throw new Error(`web apply failed: ${web.error}`);
    }
    await waitForPush(client1, (push) => push.type === 'settings/updated');
    await waitForPush(client2, (push) => push.type === 'settings/updated');

    const again = requireSuccess(await client1.client.request({ type: 'settings/get' }), 'get2');
    const next = (again.data as { snapshot: SettingsSnapshot }).snapshot;
    const nextThinkingHash = next.domainRevisions.thinking;
    if (nextThinkingHash === undefined) {
      throw new Error('missing thinking hash after rebase');
    }
    const conflict = await client2.client.request(
      {
        type: 'settings/apply',
        input: {
          expectedRevision: snapshot.revision,
          expectedDomainRevisions: { thinking: thinkingHash },
          mutations: [{ kind: 'replace-domain', domain: 'thinking', value: { ultraEnabled: false } }],
        },
      },
      { idempotencyKey: 'settings-thinking-stale' },
    );
    expect(conflict.success).toBe(false);
    if (!conflict.success) {
      expect(conflict.problem).toMatchObject({
        code: 'settings-revision-conflict',
        data: { conflictingDomains: ['thinking'] },
      });
    }
  });

  it('accepts a remote Run Mode settings/apply', async () => {
    const { client1 } = await startHarness({ hang: false });
    const loaded = requireSuccess(await client1.client.request({ type: 'settings/get' }), 'get');
    const snapshot = (loaded.data as { snapshot: SettingsSnapshot }).snapshot;
    const permissionsHash = snapshot.domainRevisions.permissions;
    expect(permissionsHash).toBeTruthy();
    if (permissionsHash === undefined) {
      throw new Error('missing permissions hash');
    }
    const applied = requireSuccess(
      await client1.client.request(
        {
          type: 'settings/apply',
          input: {
            expectedRevision: snapshot.revision,
            expectedDomainRevisions: { permissions: permissionsHash },
            mutations: [
              { kind: 'replace-domain', domain: 'permissions', value: { mode: 'auto', preset: 'auto' } },
            ],
          },
        },
        { idempotencyKey: 'run-mode-auto' },
      ),
      'permissions apply',
    );
    const next = (applied.data as { snapshot: SettingsSnapshot }).snapshot;
    expect(next.config.permissions).toEqual({ mode: 'auto', preset: 'auto' });
  });

  it('9. remote apply of desktop restore is accepted', async () => {
    const { client1 } = await startHarness({ hang: false });
    const loaded = requireSuccess(await client1.client.request({ type: 'settings/get' }), 'get');
    const snapshot = (loaded.data as { snapshot: SettingsSnapshot }).snapshot;
    const desktopHash = snapshot.domainRevisions.desktop ?? snapshot.revision;
    const applied = requireSuccess(
      await client1.client.request(
        {
          type: 'settings/apply',
          input: {
            expectedRevision: snapshot.revision,
            expectedDomainRevisions: { desktop: desktopHash },
            mutations: [
              {
                kind: 'replace-domain',
                domain: 'desktop',
                value: { composerProfile: { thinkingLevel: 'max' } },
              },
            ],
          },
        },
        { idempotencyKey: 'desktop-restore' },
      ),
      'desktop apply',
    );
    const next = (applied.data as { snapshot: SettingsSnapshot }).snapshot;
    expect(next.config.desktop?.composerProfile?.thinkingLevel).toBe('max');
  });

  it('10. concurrent permission/resolve consumes the ticket once', async () => {
    const { runtime, client1, client2 } = await startHarness({ hang: false });
    const decision = runtime.requestPermission({
      sessionId: 'perm-session',
      action: 'bash',
      detail: 'ls',
      defaultDecision: 'ask',
    });
    const request = await waitForPush(client1, (push) => push.type === 'permission/request');
    if (request.type !== 'permission/request') {
      throw new Error('expected permission/request');
    }
    const [allow, deny] = await Promise.all([
      client1.client.request(
        { type: 'permission/resolve', requestId: request.requestId, decision: 'allow' },
        { idempotencyKey: 'perm-allow' },
      ),
      client2.client.request(
        { type: 'permission/resolve', requestId: request.requestId, decision: 'deny' },
        { idempotencyKey: 'perm-deny' },
      ),
    ]);
    const accepted = [allow, deny].filter((response) => response.success);
    const rejected = [allow, deny].filter((response) => !response.success);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (!rejected[0]?.success) {
      expect(rejected[0]?.problem?.code).toBe('ticket-consumed');
    }
    await waitForPush(client1, (push) => push.type === 'permission/resolved');
    await waitForPush(client2, (push) => push.type === 'permission/resolved');
    await decision;
  });

  it('11. rename + pin from different clients both land via pushes', async () => {
    const { client1, client2 } = await startHarness({ hang: false });
    const sessionId = await createSession(client1, 'index');
    requireSuccess(
      await client1.client.request({ type: 'session/rename', sessionId, name: 'Renamed' }),
      'rename',
    );
    requireSuccess(await client2.client.request({ type: 'session/pin', sessionId }), 'pin');
    await waitForPush(
      client2,
      (push) => push.type === 'session/name-updated' && push.sessionId === sessionId,
    );
    await waitForPush(
      client1,
      (push) =>
        push.type === 'session/index-updated' &&
        push.sessionId === sessionId &&
        push.op === 'pinned',
    );
  });

  it('12. delete notifies the other viewer', async () => {
    const { client1, client2 } = await startHarness({ hang: false });
    const sessionId = await createSession(client1, 'gone');
    requireSuccess(
      await client1.client.request(
        { type: 'session/delete', sessionId, force: true },
        { idempotencyKey: randomUUID() },
      ),
      'delete',
    );
    await waitForPush(
      client2,
      (push) =>
        push.type === 'session/index-updated' &&
        push.op === 'deleted' &&
        push.sessionId === sessionId,
    );
  });

  it('13. same idempotency key is one prompt', async () => {
    const { client1 } = await startHarness();
    const sessionId = await createSession(client1, 'idem');
    const key = 'gesture-same';
    const first = requireSuccess(await promptIfIdle(client1, sessionId, 'once', key), 'first');
    const second = requireSuccess(await promptIfIdle(client1, sessionId, 'once', key), 'replay');
    expect((first.data as { runId: string }).runId).toBe((second.data as { runId: string }).runId);
  });

  it('15. second Host on the same root fails the lock', async () => {
    const { rootDir } = await startHarness({ hang: false, rootOwnership: true });
    expect(
      () =>
        new HostRuntime({
          mode: 'sdk',
          mock: true,
          piwinRoot: rootDir,
          rootOwnership: { enabled: true, ownerKind: 'test' },
        }),
    ).toThrow(/already owned|piwin-root|lock/i);
  });

  it('16. reserved body job makes prompt session-busy', async () => {
    const { runtime, client1 } = await startHarness({ hang: false });
    const sessionId = await createSession(client1, 'body');
    const reserved = (
      runtime as unknown as { sessionBodyGate: { tryReserve: (id: string) => boolean } }
    ).sessionBodyGate.tryReserve(sessionId);
    expect(reserved).toBe(true);
    const prompted = await promptIfIdle(client1, sessionId, 'blocked');
    expect(prompted.success).toBe(false);
    if (!prompted.success) {
      expect(prompted.problem).toMatchObject({
        code: 'session-busy',
        data: { reason: 'body-job' },
      });
    }
  });

  it('17. child-session prompt does not abort the parent run', async () => {
    const { runtime, client1, client2 } = await startHarness();
    const parentId = await createSession(client1, 'parent');
    const parent = requireSuccess(await promptIfIdle(client1, parentId, 'parent-live'), 'parent');
    const parentRunId = (parent.data as { runId: string }).runId;
    // Remote session/create refuses parentSessionId; the Host process can still
    // spawn the child. The assertion is that the child's prompt is not parent abort.
    const childCreated = requireSuccess(
      await runtime.handleCommand({
        type: 'session/create',
        input: {
          scope: { kind: 'general' },
          sessionName: 'child',
          parentSessionId: parentId,
        },
      }),
      'child create',
    );
    const childId = (childCreated.data as { sessionId: string }).sessionId;
    requireSuccess(await promptIfIdle(client2, childId, 'child-live'), 'child prompt');
    const still = requireSuccess(
      await client1.client.request({ type: 'session/foreground-run', sessionId: parentId }),
      'parent foreground',
    );
    expect((still.data as { run?: { runId: string } | null }).run?.runId).toBe(parentRunId);
  });

  it('S5. notes and todos CAS across two clients', async () => {
    const { client1, client2 } = await startHarness({ hang: false });
    const sessionId = await createSession(client1, 'todos');
    const written = requireSuccess(
      await client1.client.request(
        {
          type: 'notes/write',
          input: { title: 'one', content: 'alpha' },
        },
        { idempotencyKey: 'note-write-1' },
      ),
      'notes/write',
    );
    const note = (written.data as { record: { id: string; contentHash: string } }).record;
    const other = requireSuccess(
      await client2.client.request(
        {
          type: 'notes/write',
          input: { title: 'two', content: 'beta' },
        },
        { idempotencyKey: 'note-write-2' },
      ),
      'notes/write 2',
    );
    expect((other.data as { record: { id: string } }).record.id).not.toBe(note.id);
    requireSuccess(
      await client1.client.request(
        {
          type: 'notes/update',
          input: { id: note.id, content: 'alpha-2', expectedContentHash: note.contentHash },
        },
        { idempotencyKey: 'note-update-1' },
      ),
      'notes/update',
    );
    const stale = await client2.client.request(
      {
        type: 'notes/update',
        input: { id: note.id, content: 'lost', expectedContentHash: note.contentHash },
      },
      { idempotencyKey: 'note-update-stale' },
    );
    expect(stale.success).toBe(false);
    if (!stale.success) {
      expect(stale.problem?.code).toBe('notes-revision-conflict');
    }

    const empty = requireSuccess(
      await client1.client.request({ type: 'todo/get', sessionId }),
      'todo/get',
    );
    const revision = (empty.data as { revision: string }).revision;
    requireSuccess(
      await client1.client.request(
        {
          type: 'todo/set',
          sessionId,
          items: [{ id: 't1', content: 'one', status: 'pending' }],
          expectedRevision: revision,
        },
        { idempotencyKey: 'todo-1' },
      ),
      'todo/set',
    );
    await waitForPush(
      client2,
      (push) => push.type === 'todo/updated' && push.sessionId === sessionId,
    );
    const staleTodo = await client2.client.request(
      {
        type: 'todo/set',
        sessionId,
        items: [{ id: 't2', content: 'two', status: 'pending' }],
        expectedRevision: revision,
      },
      { idempotencyKey: 'todo-stale' },
    );
    expect(staleTodo.success).toBe(false);
    if (!staleTodo.success) {
      expect(staleTodo.problem?.code).toBe('todo-revision-conflict');
    }
  });
});
