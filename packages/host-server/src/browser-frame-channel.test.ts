/**
 * Remote binary browser-frame channel (spec §4.1.2).
 *
 * The control channel carries bounded metadata only; pixels travel as a
 * `version + headerLength + JSON header + JPEG` envelope on the same
 * authenticated socket, and only to a client that declared the capability and
 * currently mirrors the workbench.
 */
import { describe, expect, it } from 'vitest';
import type {
  BrowserFrameBinaryHeader,
  HostCommand,
  HostPush,
  HostResponse,
  HostWireMessage,
  PushSink,
} from '@piwin/contracts';
import { BROWSER_FRAME_BINARY_MIME, BROWSER_FRAME_BINARY_VERSION } from '@piwin/contracts';
import { WebSocket } from 'ws';
import { decodeBrowserFrameBinary, decodeHostWireMessage, encodeHostWireMessage } from '@piwin/host-transport';
import { HostServer, type HostRuntimePort } from './host-server.js';

class FakeRuntime implements HostRuntimePort {
  private readonly sinks = new Map<string, PushSink>();
  private frameSink: ((header: BrowserFrameBinaryHeader, bytes: Uint8Array) => void) | undefined;

  public async handleCommand(command: HostCommand): Promise<HostResponse> {
    return {
      type: 'response',
      command: command.type,
      success: true,
      data: {},
    };
  }

  public attachPushSink(sink: PushSink): () => void {
    this.sinks.set(sink.id, sink);
    return () => this.sinks.delete(sink.id);
  }

  public attachBrowserFrameSink(
    sink: (header: BrowserFrameBinaryHeader, bytes: Uint8Array) => void,
  ): () => void {
    this.frameSink = sink;
    return () => {
      this.frameSink = undefined;
    };
  }

  public emit(push: HostPush): void {
    for (const sink of this.sinks.values()) sink.push(push);
  }

  public emitFrame(header: BrowserFrameBinaryHeader, bytes: Uint8Array): void {
    if (this.frameSink === undefined) throw new Error('browser frame sink is not attached');
    this.frameSink(header, bytes);
  }
}

type Client = {
  socket: WebSocket;
  json: HostWireMessage[];
  binary: Uint8Array[];
  send: (message: HostWireMessage) => void;
  hello: (capabilities?: { browserFrameBinary?: true }) => Promise<void>;
  command: (command: HostCommand) => Promise<HostWireMessage>;
};

async function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

async function connectClient(
  address: { url: string },
  clientId: string,
): Promise<Client> {
  const socket = new WebSocket(address.url);
  const json: HostWireMessage[] = [];
  const binary: Uint8Array[] = [];
  socket.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      binary.push(new Uint8Array(data));
      return;
    }
    json.push(decodeHostWireMessage(data.toString()));
  });
  await waitForOpen(socket);
  let requestSeq = 0;
  const send = (message: HostWireMessage): void => {
    socket.send(encodeHostWireMessage(message));
  };
  const waitFor = async (
    predicate: (message: HostWireMessage) => boolean,
  ): Promise<HostWireMessage> => {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const found = json.findIndex(predicate);
      if (found >= 0) return json.splice(found, 1)[0] as HostWireMessage;
      if (Date.now() > deadline) throw new Error('Timed out waiting for Host message');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  return {
    socket,
    json,
    binary,
    send,
    async hello(capabilities) {
      send({
        type: 'client/hello',
        protocolVersion: 1,
        clientType: 'desktop',
        clientVersion: 'test',
        clientId,
        lastSeq: 0,
        ...(capabilities === undefined ? {} : { capabilities }),
      });
      await waitFor((message) => message.type === 'host/hello');
    },
    async command(command) {
      requestSeq += 1;
      const requestId = `${clientId}-${String(requestSeq)}`;
      send({ type: 'command', requestId, command } as HostWireMessage);
      return await waitFor(
        (message) => message.type === 'response' && message.requestId === requestId,
      );
    },
  };
}

const HEADER: BrowserFrameBinaryHeader = {
  version: BROWSER_FRAME_BINARY_VERSION,
  frameId: '3',
  generation: 1,
  pageId: 'page-1',
  documentRevision: 0,
  width: 1280,
  height: 800,
  encodedWidth: 2560,
  encodedHeight: 1600,
  byteLength: 4,
  mime: BROWSER_FRAME_BINARY_MIME,
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe('HostServer browser frame channel', () => {
  it('publishes metadata with a binary payload and sends the JPEG out of band', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-frame-test' });
    const address = await server.start();
    const client = await connectClient(address, 'desktop-frame');
    await client.hello({ browserFrameBinary: true });
    const startResponse = await client.command({ type: 'browser/start', leaseId: 'lease-1' });
    if (startResponse.type !== 'response') throw new Error('expected a command response');
    expect(startResponse.response).toMatchObject({ success: true });

    runtime.emitFrame(HEADER, JPEG);
    runtime.emit({
      type: 'browser/frame',
      ts: Date.now(),
      frameId: '3',
      width: 1280,
      height: 800,
      encodedWidth: 2560,
      encodedHeight: 1600,
      sourceDpr: 2,
      quality: 80,
      producer: 'screencast',
      byteLength: 4,
      generation: 1,
      pageId: 'page-1',
      documentRevision: 0,
      payload: { kind: 'inline', dataUrl: 'data:image/jpeg;base64,AAAA' },
    });

    const metadata = await new Promise<HostWireMessage>((resolve, reject) => {
      const deadline = Date.now() + 5_000;
      const poll = (): void => {
        const found = client.json.findIndex(
          (message) => message.type === 'push' && message.push.type === 'browser/frame',
        );
        if (found >= 0) {
          resolve(client.json.splice(found, 1)[0] as HostWireMessage);
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error('Timed out waiting for frame metadata'));
          return;
        }
        setTimeout(poll, 5);
      };
      poll();
    });
    if (metadata.type !== 'push' || metadata.push.type !== 'browser/frame') {
      throw new Error('expected a browser/frame push');
    }
    // The projected payload never carries the pixels and never says [redacted].
    expect(metadata.push.payload).toEqual({ kind: 'binary' });
    expect(JSON.stringify(metadata.push)).not.toContain('dataUrl');

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(client.binary).toHaveLength(1);
    const decoded = decodeBrowserFrameBinary(client.binary[0] as Uint8Array);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.header.frameId).toBe('3');
    expect(Array.from(decoded.jpeg)).toEqual(Array.from(JPEG));

    client.socket.close();
    await server.stop();
  });

  it('tells a client without the capability that its shell needs updating', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-frame-legacy' });
    const address = await server.start();
    const client = await connectClient(address, 'desktop-legacy');
    await client.hello();
    const legacyStart = await client.command({ type: 'browser/start', leaseId: 'lease-1' });
    if (legacyStart.type !== 'response') throw new Error('expected a command response');
    expect(legacyStart.response).toMatchObject({ success: true });

    runtime.emitFrame(HEADER, JPEG);
    runtime.emit({
      type: 'browser/frame',
      ts: Date.now(),
      frameId: '4',
      width: 320,
      height: 240,
      encodedWidth: 640,
      encodedHeight: 480,
      sourceDpr: 2,
      quality: 80,
      producer: 'screencast',
      byteLength: 4,
      generation: 1,
      pageId: 'page-1',
      documentRevision: 0,
      payload: { kind: 'inline', dataUrl: 'data:image/jpeg;base64,AAAA' },
    });

    const push = await new Promise<HostWireMessage>((resolve, reject) => {
      const deadline = Date.now() + 5_000;
      const poll = (): void => {
        const found = client.json.findIndex(
          (message) => message.type === 'push' && message.push.type === 'browser/frame',
        );
        if (found >= 0) {
          resolve(client.json.splice(found, 1)[0] as HostWireMessage);
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error('Timed out waiting for frame metadata'));
          return;
        }
        setTimeout(poll, 5);
      };
      poll();
    });
    if (push.type !== 'push' || push.push.type !== 'browser/frame') {
      throw new Error('expected a browser/frame push');
    }
    expect(push.push.payload).toEqual({
      kind: 'unavailable',
      reason: 'client-update-required',
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(client.binary).toHaveLength(0);

    client.socket.close();
    await server.stop();
  });

  it('withholds frames from a capable client that is not mirroring the workbench', async () => {
    const runtime = new FakeRuntime();
    const server = new HostServer({ runtime, port: 0, instanceId: 'host-frame-idle' });
    const address = await server.start();
    const client = await connectClient(address, 'desktop-idle');
    await client.hello({ browserFrameBinary: true });

    runtime.emitFrame(HEADER, JPEG);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(client.binary).toHaveLength(0);

    client.socket.close();
    await server.stop();
  });
});
