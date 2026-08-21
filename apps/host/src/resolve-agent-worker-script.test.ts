import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveAgentWorkerScript } from './resolve-agent-worker-script.js';

describe('resolveAgentWorkerScript', () => {
  it('prefers PIWIN_AGENT_WORKER_SCRIPT', () => {
    expect(
      resolveAgentWorkerScript({
        env: { PIWIN_AGENT_WORKER_SCRIPT: '/tmp/custom-worker.mjs' },
      }),
    ).toBe(resolve('/tmp/custom-worker.mjs'));
  });

  it('uses agent-worker.mjs beside the entry when present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-worker-script-'));
    await writeFile(join(dir, 'agent-worker.mjs'), '// worker\n', 'utf8');
    const importMetaUrl = pathToFileURL(join(dir, 'host-listen.mjs')).href;
    expect(resolveAgentWorkerScript({ importMetaUrl })).toBe(join(dir, 'agent-worker.mjs'));
  });

  it('returns undefined when nothing is found', () => {
    const importMetaUrl = pathToFileURL(join(tmpdir(), 'missing-host-listen.mjs')).href;
    expect(resolveAgentWorkerScript({ env: {}, importMetaUrl })).toBeUndefined();
  });
});
