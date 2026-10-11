import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostPush, HostResponse, PushSink } from '@piwin/contracts';
import { HostClient } from '@piwin/host-client';
import { WebSocketHostTransport } from '@piwin/host-transport';
import { HostServer, type HostRuntimePort } from './host-server.js';

class TerminalRuntime implements HostRuntimePort {
  public readonly commands: HostCommand[] = [];
  public opens = 0;
  private readonly sinks = new Set<PushSink>();
  public readonly frame = '\x1b[2J\x1b[H\x1b[38;2;230;80;60mGrok Build\x1b[0m\r\n'+ '中文'.repeat(20_000);
  public async handleCommand(command: HostCommand): Promise<HostResponse> {
    this.commands.push(command);
    if (command.type === 'host/status') return this.ok(command, { mode: 'sdk', ready: true, mock: true, activeSessionIds: [], capabilities: {} });
    if (command.type === 'agents/cli-open') {
      this.opens += 1;
      this.emit({ type: 'pty/output', ptyId: 'remote-pty', data: this.frame, at: new Date().toISOString() });
      return this.ok(command, { ptyId: 'remote-pty', sessionId: 'product-session' });
    }
    if (command.type === 'pty/close') this.emit({ type: 'pty/exit', ptyId: command.ptyId, exitCode: 0 });
    return this.ok(command, {});
  }
  public attachPushSink(sink: PushSink): () => void {
    this.sinks.add(sink);
    return () => { this.sinks.delete(sink); };
  }
  public attachBrowserFrameSink(): () => void { return () => undefined; }
  private emit(push: HostPush): void { for (const sink of this.sinks) sink.push(push); }
  private ok(command: HostCommand, data: unknown): HostResponse {
    return { type: 'response', command: command.type, success: true, data };
  }
}

it('carries native terminal frames and controls over the real remote protocol without duplicating opens', async () => {
  const runtime = new TerminalRuntime();
  const server = new HostServer({ runtime, port: 0, instanceId: 'grok-terminal-remote' });
  const address = await server.start();
  const client = new HostClient({
    transport: new WebSocketHostTransport({ endpoint: address.url, autoReconnect: false }),
    clientId: 'desktop-cli-test', clientType: 'desktop', clientVersion: 'test',
    capabilities: { pushBatching: true, cursorBatches: true, liveSubscriptions: true },
    subscriptions: { sessionIds: ['product-session'] },
  });
  const pushes: HostPush[] = [];
  client.subscribePush((push) => pushes.push(push));
  try {
    await client.connect();
    const open: HostCommand = { type: 'agents/cli-open', input: { agentId: 'grok', sessionId: 'product-session', cols: 80, rows: 24 } };
    const first = await client.request(open, { idempotencyKey: 'one-cli-click' });
    expect(first).toMatchObject({ success: true, data: { ptyId: 'remote-pty', sessionId: 'product-session' } });
    expect(await client.request(open, { idempotencyKey: 'one-cli-click' })).toMatchObject({ success: true, data: first.success ? first.data : {} });
    expect(runtime.opens).toBe(1);
    await vi.waitFor(() => expect(pushes.find((push) => push.type === 'pty/output')).toMatchObject({ data: runtime.frame }));
    await client.request({ type: 'pty/write', ptyId: 'remote-pty', data: '\x1b[A你好\r' });
    await client.request({ type: 'pty/resize', ptyId: 'remote-pty', cols: 100, rows: 30 });
    await client.request({ type: 'pty/close', ptyId: 'remote-pty' });
    await vi.waitFor(() => expect(pushes.find((push) => push.type === 'pty/exit')).toMatchObject({ ptyId: 'remote-pty', exitCode: 0 }));
    expect(runtime.commands).toContainEqual({ type: 'pty/write', ptyId: 'remote-pty', data: '\x1b[A你好\r', id: expect.any(String) });
    const before = runtime.commands.length;
    await expect(client.request({ type: 'pty/resize', ptyId: 'remote-pty', cols: 0, rows: 30 })).rejects.toThrow('Remote command payload was rejected');
    expect(runtime.commands).toHaveLength(before);
  } finally {
    await client.close();
    await server.stop();
  }
});
