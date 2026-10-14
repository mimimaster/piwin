/**
 * Local user-owned Claude binary through the independent plugin artifact.
 * Does not send a provider prompt (no model network). Codex is not included:
 * the platform vendor binary is missing on this machine.
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
import { createExtensionRevisionStore, installExtension } from '@piwin/extensions';
import { HostRuntime } from './host-runtime.js';

const CLAUDE_REPO = process.env.PIWIN_CLAUDE_BACKEND ?? '/Volumes/BigDisk/Developer/piwin-claude-code-backend';
const CLAUDE_BIN = process.env.CLAUDE_CLI ?? '/Volumes/BigDisk/npm-global/bin/claude';
const present = existsSync(join(CLAUDE_REPO, 'dist/agent.mjs')) && existsSync(CLAUDE_BIN);

function data(response: HostResponse): unknown {
  if (!response.success) throw new Error(`${response.command}: ${response.error}`);
  return response.data;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe.skipIf(!present)('user-owned Claude binary via independent plugin', () => {
  it('check() is ready on the user binary and session/create does not spawn a SDK platform package', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cc-bin-'));
    const source = join(rootDir, 'claude-source');
    await mkdir(join(source, 'dist'), { recursive: true });
    await cp(join(CLAUDE_REPO, 'dist/agent.mjs'), join(source, 'dist/agent.mjs'));
    await cp(join(CLAUDE_REPO, 'piwin.json'), join(source, 'piwin.json'));
    await writeFile(join(source, 'package.json'), `${JSON.stringify({ name: 'claude-code', version: '0.1.0', private: true })}\n`);
    const installed = await installExtension({
      piwinRoot: rootDir,
      source: { kind: 'local', path: source },
      name: 'claude-code',
    });
    await createExtensionRevisionStore(rootDir).setEnabled(installed.extensionId, true);

    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      externalAgents: { env: { ...process.env, PATH: `${dirname(CLAUDE_BIN)}:${process.env.PATH ?? ''}` } },
    });
    cleanups.push(async () => {
      await runtime.dispose();
      await rm(rootDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
    });

    const status = data(await runtime.handleCommand({ type: 'agents/status', agentId: 'claude-code', refresh: true })) as {
      agents: Array<{ agentId: string; state: string; binaryPath?: string }>;
    };
    const claude = status.agents.find((agent) => agent.agentId === 'claude-code');
    expect(claude?.state).toBe('ready');
    expect(claude?.binaryPath).toBeDefined();
    expect(claude?.binaryPath ?? '').not.toMatch(/claude-agent-sdk-/);

    const projectPath = join(rootDir, 'project');
    await mkdir(projectPath);
    const created = data(await runtime.handleCommand({
      type: 'session/create',
      input: { agentId: 'claude-code', projectPath },
    })) as { sessionId: string };
    expect(created.sessionId.length).toBeGreaterThan(0);
  });
});
