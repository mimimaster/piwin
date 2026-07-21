import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentHost } from './create-host.js';

describe('createAgentHost', () => {
  it('returns sdk adapter', () => {
    const host = createAgentHost({ mode: 'sdk', mock: true });
    expect(host.mode).toBe('sdk');
  });

  it('returns rpc adapter', () => {
    const host = createAgentHost({ mode: 'rpc', mock: true });
    expect(host.mode).toBe('rpc');
  });

  it('mock session streams text events', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-create-host-'));
    const host = createAgentHost({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const session = await host.createSession({ projectPath: '/tmp/project' });
    const deltas: string[] = [];
    const unsubscribe = session.subscribe((event) => {
      if (event.type === 'message/text_delta') {
        deltas.push(event.delta);
      }
    });
    await session.prompt({ text: 'hello mock' });
    unsubscribe();
    expect(deltas.join('')).toContain('hello mock');
    await host.dispose();
  });
});
