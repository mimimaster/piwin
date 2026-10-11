import type { HostCommand, HostServerMessage } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createAgentCliPty, type AgentCliHost } from './agent-cli-pty.js';
import { connectXtermPty } from './xterm-pty-connection.js';

function setup(fail = false) {
  const listeners = new Set<(push: HostServerMessage) => void>();
  const request = vi.fn(async (command: HostCommand) => {
    if (fail) return { type: 'response' as const, command: command.type, success: false as const, error: 'CLI missing' };
    if (command.type === 'agents/cli-open') {
      for (const listener of listeners) listener({ type: 'pty/output', ptyId: 'remote-pty', data: 'Grok Build', at: '' });
      return { type: 'response' as const, command: command.type, success: true as const, data: { ptyId: 'remote-pty', sessionId: 'product-id' } };
    }
    return { type: 'response' as const, command: command.type, success: true as const, data: {} };
  });
  const host: AgentCliHost = { request, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { host, request, listeners };
}

describe('Host-native Grok xterm transport', () => {
  it('buffers startup output, adopts the product session and routes I/O to the same Host', async () => {
    const port = setup(); const session = vi.fn(); const data = vi.fn();
    const pty = createAgentCliPty(port.host, { agentId: 'grok', sessionId: 'product-id', projectPath: 'project-'+'a'.repeat(24) }, session);
    const abort = new AbortController();
    await connectXtermPty({ signal: abort.signal, transport: pty.transport, open: () => pty.open({ cols: 80, rows: 24 }), onOpen: vi.fn(), onData: data, onExit: vi.fn() });
    expect(data).toHaveBeenCalledWith('Grok Build');
    expect(session).toHaveBeenCalledWith('product-id');
    expect(port.request).toHaveBeenCalledWith(expect.objectContaining({ type: 'agents/cli-open' }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }));
    await pty.transport.write('remote-pty', 'hello');
    await pty.transport.resize('remote-pty', 100, 30);
    expect(port.request).toHaveBeenCalledWith({ type: 'pty/write', ptyId: 'remote-pty', data: 'hello' });
    expect(port.request).toHaveBeenCalledWith({ type: 'pty/resize', ptyId: 'remote-pty', cols: 100, rows: 30 });
    abort.abort();
    expect(port.listeners.size).toBe(0);
    expect(port.request).toHaveBeenCalledWith({ type: 'pty/close', ptyId: 'remote-pty' });
  });
  it('reports a missing CLI without adopting a session or leaving listeners', async () => {
    const port = setup(true); const session = vi.fn();
    const pty = createAgentCliPty(port.host, { agentId: 'grok' }, session);
    await expect(connectXtermPty({ signal: new AbortController().signal, transport: pty.transport,
      open: () => pty.open({ cols: 80, rows: 24 }), onOpen: vi.fn(), onData: vi.fn(), onExit: vi.fn() })).rejects.toThrow('CLI missing');
    expect(session).not.toHaveBeenCalled(); expect(port.listeners.size).toBe(0);
  });
});
