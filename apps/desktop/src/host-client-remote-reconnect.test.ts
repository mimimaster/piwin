import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostHello, HostPush, HostServerMessage } from '@piwin/contracts';
import { HostClient } from './host-client.js';

const hello: HostHello = {
  type: 'host/hello',
  protocolVersion: 1,
  hostInstanceId: 'host-1',
  currentSeq: 0,
  authRequired: false,
  authenticated: true,
    capabilities: {
    allowedCommands: ['host/ping', 'host/status', 'session/prompt'],
    pushSequencing: true,
    replay: true,
    snapshot: true,
    sessionRead: true,
    sessionControl: true,
    permissionResolve: true,
    mediaUpload: false,
    foregroundRunAdmission: true,
  },
};

type RemoteState = {
  kind: 'idle' | 'connecting' | 'ready' | 'disconnected' | 'error' | 'resync-required';
  reason?: string;
};

class FakeRemoteClient {
  state: RemoteState = { kind: 'idle' };
  readonly requests: string[] = [];
  private hello: HostHello | undefined;
  private readonly stateListeners = new Set<(state: RemoteState) => void>();
  private readonly pushListeners = new Set<(push: HostPush) => void>();
  private readonly binaryListeners = new Set<(bytes: Uint8Array) => void>();
  deferConnect = false;
  private pendingConnectResolve: ((hello: HostHello) => void) | undefined;

  connect = vi.fn(async () => {
    if (this.deferConnect) {
      return await new Promise<HostHello>((resolve) => {
        this.pendingConnectResolve = resolve;
      });
    }
    this.hello = hello;
    this.state = { kind: 'ready' };
    this.emitState();
    return hello;
  });

  request = vi.fn(async (command: { type: string }): Promise<{
    type: 'response';
    command: string;
    success: boolean;
    data?: unknown;
    error?: string;
  }> => {
    this.requests.push(command.type);
    return {
      type: 'response',
      command: command.type,
      success: true,
      data: { mode: 'sdk', ready: true, mock: false, hostInstanceId: 'host-1' },
    };
  });

  subscribePush(listener: (push: HostPush) => void): () => void {
    this.pushListeners.add(listener);
    return () => {
      this.pushListeners.delete(listener);
    };
  }

  emitPush(push: HostPush): void {
    for (const listener of this.pushListeners) {
      listener(push);
    }
  }

  subscribeHydration(): () => void {
    return () => undefined;
  }

  /** Remote JPEG frames; HostClient attaches this as soon as it has a client. */
  subscribeBinary(listener: (bytes: Uint8Array) => void): () => void {
    this.binaryListeners.add(listener);
    return () => {
      this.binaryListeners.delete(listener);
    };
  }

  subscribeSnapshot(): () => void {
    return () => undefined;
  }

  subscribeState(listener: (state: RemoteState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  getState(): RemoteState {
    return this.state;
  }

  getHostHello(): HostHello | undefined {
    return this.hello;
  }

  close = vi.fn(async () => undefined);

  drop(): void {
    this.hello = undefined;
    this.state = { kind: 'disconnected', reason: 'Host connection closed' };
    this.emitState();
  }

  reconnect(): void {
    this.hello = hello;
    this.state = { kind: 'ready' };
    this.emitState();
  }

  /** Mid-reconnect: socket dialing, no hello yet. */
  beginReconnectDial(): void {
    this.hello = undefined;
    this.state = { kind: 'connecting' };
    this.emitState();
  }

  /** Hello landed; package still catching up (connecting). */
  admitHelloWhileCatchingUp(): void {
    this.hello = hello;
    this.state = { kind: 'connecting' };
    this.emitState();
    this.pendingConnectResolve?.(hello);
    this.pendingConnectResolve = undefined;
  }

  emitState(): void {
    for (const listener of this.stateListeners) {
      listener(this.state);
    }
  }
}

const remotes: FakeRemoteClient[] = [];
let deferNextRemoteConnect = false;

vi.mock('./remote-host-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./remote-host-session.js')>();
  return {
    ...actual,
    createDesktopRemoteHostClient: () => {
      const remote = new FakeRemoteClient();
      remote.deferConnect = deferNextRemoteConnect;
      deferNextRemoteConnect = false;
      remotes.push(remote);
      return remote;
    },
  };
});

describe('HostClient remote reconnect', () => {
  beforeEach(() => {
    remotes.length = 0;
    deferNextRemoteConnect = false;
  });

  it('tells the shell it is offline when the socket drops', async () => {
    const client = new HostClient({
      transport: 'remote',
      remoteTarget: { endpoint: 'ws://127.0.0.1:8787' },
    });
    const statuses: HostServerMessage[] = [];
    client.subscribe((message) => {
      if (message.type === 'host/status') {
        statuses.push(message);
      }
    });
    await client.connect();
    expect(client.isReady()).toBe(true);
    remotes[0]?.drop();
    expect(client.isReady()).toBe(false);
    expect(statuses.at(-1)).toMatchObject({ type: 'host/status', ready: false });
  });

  it('treats hello as ready even when host/status times out', async () => {
    const client = new HostClient({
      transport: 'remote',
      remoteTarget: { endpoint: 'ws://127.0.0.1:8787' },
    });
    const statuses: HostServerMessage[] = [];
    client.subscribe((message) => {
      if (message.type === 'host/status') {
        statuses.push(message);
      }
    });
    const pending = client.connect();
    const live = remotes[0];
    expect(live).toBeDefined();
    live!.request = vi.fn(async (command: { type: string }) => {
      live!.requests.push(command.type);
      return {
        type: 'response' as const,
        command: command.type,
        success: false,
        error: 'Host request timed out: host/status',
      };
    });
    await pending;
    expect(client.isReady()).toBe(true);
    expect(statuses.at(-1)).toMatchObject({ type: 'host/status', ready: true });
  });

  it('marks the shell ready again after a Host restart without waiting on status', async () => {
    const client = new HostClient({
      transport: 'remote',
      remoteTarget: { endpoint: 'ws://127.0.0.1:8787' },
    });
    const statuses: HostServerMessage[] = [];
    client.subscribe((message) => {
      if (message.type === 'host/status') {
        statuses.push(message);
      }
    });
    await client.connect();
    const live = (remotes[0] ?? new FakeRemoteClient()) as FakeRemoteClient;
    live.drop();
    expect(client.isReady()).toBe(false);
    live.request = vi.fn(async (command: { type: string }) => {
      live.requests.push(command.type);
      return {
        type: 'response' as const,
        command: command.type,
        success: false,
        error: 'Host request timed out: host/status',
      };
    });
    live.reconnect();
    expect(client.isReady()).toBe(true);
    expect(statuses.at(-1)).toMatchObject({ type: 'host/status', ready: true });
  });

  it('unblocks the shell on hello while package catch-up is still connecting', async () => {
    const client = new HostClient({
      transport: 'remote',
      remoteTarget: { endpoint: 'ws://127.0.0.1:8787' },
    });
    await client.connect();
    const live = remotes[0];
    expect(live).toBeDefined();
    live!.drop();
    expect(client.isReady()).toBe(false);
    live!.beginReconnectDial();
    expect(client.isReady()).toBe(false);
    live!.admitHelloWhileCatchingUp();
    expect(client.isReady()).toBe(true);
  });

  it('does not go offline when a replayed host/status says ready:false', async () => {
    const client = new HostClient({
      transport: 'remote',
      remoteTarget: { endpoint: 'ws://127.0.0.1:8787' },
    });
    const statuses: HostServerMessage[] = [];
    client.subscribe((message) => {
      if (message.type === 'host/status') {
        statuses.push(message);
      }
    });
    await client.connect();
    expect(client.isReady()).toBe(true);
    remotes[0]?.emitPush({ type: 'host/status', mode: 'sdk', ready: false, mock: false });
    expect(client.isReady()).toBe(true);
    expect(statuses.at(-1)).toMatchObject({ type: 'host/status', ready: false });
  });

  it('admits hello while bootstrap connect is still pending', async () => {
    deferNextRemoteConnect = true;
    const client = new HostClient({
      transport: 'remote',
      remoteTarget: { endpoint: 'ws://127.0.0.1:8787' },
    });
    const pending = client.connect();
    const live = remotes[0];
    expect(live).toBeDefined();
    live!.admitHelloWhileCatchingUp();
    expect(client.isReady()).toBe(true);
    await pending;
  });

  it('waits for the initial remote hello before sending a request', async () => {
    deferNextRemoteConnect = true;
    const client = new HostClient({
      transport: 'remote',
      remoteTarget: { endpoint: 'ws://127.0.0.1:8787' },
    });
    const connecting = client.connect();
    const pending = client.request({ type: 'host/status' });
    const live = remotes[0];
    expect(live).toBeDefined();
    expect(live?.requests).toEqual([]);

    live!.admitHelloWhileCatchingUp();

    await connecting;
    await expect(pending).resolves.toMatchObject({ success: true });
    expect(live?.requests).toEqual(['host/status', 'host/status']);
  });

  it('fails a click immediately while the socket is down', async () => {
    const client = new HostClient({
      transport: 'remote',
      remoteTarget: { endpoint: 'ws://127.0.0.1:8787' },
    });
    await client.connect();
    const remote = remotes[0];
    remote?.drop();
    const before = remote?.requests.length ?? 0;
    const response = await client.request(
      {
        type: 'session/prompt',
        sessionId: 'session-1',
        input: { text: 'hi' },
        foreground: { kind: 'if-idle' },
      },
      { idempotencyKey: 'reconnect-click' },
    );
    expect(response).toMatchObject({
      success: false,
      error: 'Host transport is not open',
    });
    expect(remote?.requests.length).toBe(before);
  });
});
