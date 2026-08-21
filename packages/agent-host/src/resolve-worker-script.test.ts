import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MISSING_WORKER_ARTIFACT_ERROR,
  resolveWorkerLaunch,
} from './resolve-worker-script.js';

describe('resolveWorkerLaunch', () => {
  it('keeps an explicit workerScript and does not add tsx for bundled files', () => {
    const launch = resolveWorkerLaunch({
      workerScript: '/tmp/agent-worker.mjs',
      env: { PIWIN_AGENT_WORKER_SCRIPT: '/tmp/ignored.mjs' },
    });
    expect(launch).toEqual({ workerScript: '/tmp/agent-worker.mjs', nodeArgs: [] });
  });

  it('prepends tsx when the explicit script is TypeScript', () => {
    const launch = resolveWorkerLaunch({
      workerScript: '/tmp/rpc-sdk-worker-entry.ts',
      env: {},
    });
    expect(launch.workerScript).toBe('/tmp/rpc-sdk-worker-entry.ts');
    expect(launch.nodeArgs).toEqual(['--import', 'tsx']);
  });

  it('does not duplicate --import tsx when the caller already passed it', () => {
    const launch = resolveWorkerLaunch({
      workerScript: '/tmp/rpc-sdk-worker-entry.ts',
      nodeArgs: ['--import', 'tsx'],
      env: {},
    });
    expect(launch.nodeArgs).toEqual(['--import', 'tsx']);
  });

  it('prefers PIWIN_AGENT_WORKER_SCRIPT when no explicit script is set', () => {
    const launch = resolveWorkerLaunch({
      env: { PIWIN_AGENT_WORKER_SCRIPT: '/tmp/custom-worker.mjs' },
    });
    expect(launch.workerScript).toBe(resolve('/tmp/custom-worker.mjs'));
    expect(launch.nodeArgs).toEqual([]);
  });

  it('uses a real agent-worker.mjs beside the entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-worker-packaged-'));
    const body = `${'// packaged worker\n'.repeat(20)}export {}\n`;
    await writeFile(join(dir, 'agent-worker.mjs'), body, 'utf8');
    const fromUrl = pathToFileURL(join(dir, 'host-serve.mjs')).href;
    const launch = resolveWorkerLaunch({ env: {}, fromUrl, cwd: dir });
    expect(launch.workerScript).toBe(join(dir, 'agent-worker.mjs'));
    expect(launch.nodeArgs).toEqual([]);
  });

  it('skips a placeholder agent-worker.mjs and uses the source entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-worker-placeholder-'));
    await writeFile(join(dir, 'agent-worker.mjs'), '// placeholder\n', 'utf8');
    await writeFile(join(dir, 'rpc-sdk-worker-entry.ts'), 'export {}\n', 'utf8');
    const fromUrl = pathToFileURL(join(dir, 'host-serve.mjs')).href;
    const launch = resolveWorkerLaunch({ env: {}, fromUrl, cwd: process.cwd() });
    expect(launch.workerScript).toBe(join(dir, 'rpc-sdk-worker-entry.ts'));
    expect(launch.nodeArgs).toEqual(['--import', 'tsx']);
  });

  it('finds the source worker entry next to this module', () => {
    const launch = resolveWorkerLaunch({ env: {} });
    expect(launch.workerScript.endsWith('rpc-sdk-worker-entry.ts')).toBe(true);
    expect(launch.nodeArgs).toEqual(['--import', 'tsx']);
  });

  it('walks up to dist-host/agent-worker.mjs when no sibling entry exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-worker-dist-host-'));
    const nested = join(root, 'apps', 'host', 'src');
    const distHost = join(root, 'dist-host');
    await mkdir(distHost, { recursive: true });
    await writeFile(join(distHost, 'agent-worker.mjs'), `${'x'.repeat(200)}\n`, 'utf8');
    const fromUrl = pathToFileURL(join(nested, 'missing-client.js')).href;
    const launch = resolveWorkerLaunch({ env: {}, fromUrl, cwd: nested });
    expect(launch.workerScript).toBe(join(distHost, 'agent-worker.mjs'));
  });

  it('throws when nothing usable is found', () => {
    const fromUrl = pathToFileURL(join(tmpdir(), 'missing-host-serve.mjs')).href;
    expect(() => resolveWorkerLaunch({ env: {}, fromUrl, cwd: tmpdir() })).toThrow(
      MISSING_WORKER_ARTIFACT_ERROR,
    );
  });
});
