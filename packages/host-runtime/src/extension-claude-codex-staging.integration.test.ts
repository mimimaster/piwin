/**
 * Local staging of the independent Claude Code / Codex session backends.
 *
 * Artifacts stay outside this repo. The test copies only the reviewed
 * `piwin.json` + `dist/agent.mjs` into a temp Host root and never vendors
 * adapter source into `@piwin/*`.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExtensionSummary, HostPush, HostResponse } from '@piwin/contracts';
import { AGENT_PLUGIN_MAX_ARTIFACT_BYTES } from '@piwin/contracts';
import { createExtensionRevisionStore, installExtension } from '@piwin/extensions';
import { HostRuntime } from './host-runtime.js';
import { listExtensionBackends } from './extension-session-backends.js';
import {
  CLAUDE_BACKEND_ENV,
  CODEX_BACKEND_ENV,
  envPath,
  readPinnedArtifact,
  requireExternalBackends,
} from './testing/external-backend-artifacts.js';

const CLAUDE_REPO = envPath(CLAUDE_BACKEND_ENV);
const CODEX_REPO = envPath(CODEX_BACKEND_ENV);
const requiredLane = requireExternalBackends();
const configured = CLAUDE_REPO !== undefined && CODEX_REPO !== undefined;
let claudePin: ReturnType<typeof readPinnedArtifact> | undefined;
let codexPin: ReturnType<typeof readPinnedArtifact> | undefined;
let pinError: string | undefined;
if (CLAUDE_REPO !== undefined && CODEX_REPO !== undefined) {
  try {
    claudePin = readPinnedArtifact(CLAUDE_REPO);
    codexPin = readPinnedArtifact(CODEX_REPO);
  } catch (error) {
    pinError = error instanceof Error ? error.message : String(error);
  }
}
const artifactsPresent = claudePin !== undefined && codexPin !== undefined;

function data(response: HostResponse): unknown {
  if (!response.success) throw new Error(`${response.command}: ${response.error}`);
  return response.data;
}
function failure(response: HostResponse): string {
  if (response.success) throw new Error('expected failed response');
  return response.error;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function stagePlugin(rootDir: string, repo: string, name: string): Promise<{
  extensionId: string;
  agentId: string;
  byteSize: number;
}> {
  const source = join(rootDir, `${name}-source`);
  await mkdir(join(source, 'dist'), { recursive: true });
  await cp(join(repo, 'dist/agent.mjs'), join(source, 'dist/agent.mjs'));
  await cp(join(repo, 'piwin.json'), join(source, 'piwin.json'));
  const manifest = JSON.parse(await readFile(join(repo, 'piwin.json'), 'utf8')) as {
    sessionBackend: { id: string; artifact: { byteSize: number; sha256: string } };
  };
  await writeFile(
    join(source, 'package.json'),
    `${JSON.stringify({ name, version: '0.1.0', private: true }, null, 2)}\n`,
  );
  const installed = await installExtension({
    piwinRoot: rootDir,
    source: { kind: 'local', path: source },
    name,
  });
  await createExtensionRevisionStore(rootDir).setEnabled(installed.extensionId, true);
  return {
    extensionId: installed.extensionId,
    agentId: manifest.sessionBackend.id,
    byteSize: manifest.sessionBackend.artifact.byteSize,
  };
}

async function harness() {
  if (CLAUDE_REPO === undefined || CODEX_REPO === undefined) {
    throw new Error('PIWIN_CLAUDE_BACKEND and PIWIN_CODEX_BACKEND must point at pinned candidate checkouts');
  }
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cc-codex-stage-'));
  const claude = await stagePlugin(rootDir, CLAUDE_REPO, 'claude-code');
  const codex = await stagePlugin(rootDir, CODEX_REPO, 'codex');
  const runtime = new HostRuntime({
    mode: 'sdk',
    mock: true,
    piwinRoot: rootDir,
    externalAgents: {},
  });
  const pushes: HostPush[] = [];
  runtime.attachPushSink({ id: 'stage-test', push: (message) => pushes.push(message) });
  cleanups.push(async () => {
    await runtime.dispose();
    await rm(rootDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
  });
  return { rootDir, runtime, pushes, claude, codex };
}

describe('Claude Code / Codex artifact inputs (BUILD-03)', () => {
  it.skipIf(!requiredLane && !configured)('fails the required lane when pins are missing or mismatched', () => {
    if (CLAUDE_REPO === undefined || CODEX_REPO === undefined) {
      throw new Error('PIWIN_CLAUDE_BACKEND and PIWIN_CODEX_BACKEND must be set for the required integration lane');
    }
    if (pinError !== undefined) throw new Error(pinError);
    expect(claudePin?.id).toBe('claude-code');
    expect(codexPin?.id).toBe('codex');
  });
});

describe('Claude Code / Codex Host production dependencies', () => {
  it('does not vendor Claude or Codex adapters in Host production dependencies', async () => {
    const hostRuntime = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const agentHostPath = new URL('../../agent-host/package.json', import.meta.url);
    const agentHost = JSON.parse(await readFile(agentHostPath, 'utf8')) as { dependencies: Record<string, string> };
    for (const deps of [hostRuntime.dependencies, agentHost.dependencies]) {
      expect(Object.keys(deps).some((name) => name.includes('claude-agent-sdk'))).toBe(false);
      expect(Object.keys(deps).some((name) => name.includes('@openai/codex'))).toBe(false);
    }
  });
});

describe.skipIf(!artifactsPresent)('Claude Code / Codex independent Host staging', () => {
  it('installs both backends independently under the extension registry', async () => {
    const { rootDir, runtime, claude, codex } = await harness();
    expect(claude.byteSize).toBeLessThan(AGENT_PLUGIN_MAX_ARTIFACT_BYTES);
    expect(codex.byteSize).toBeLessThan(AGENT_PLUGIN_MAX_ARTIFACT_BYTES);
    expect(claude.byteSize).toBeGreaterThan(0);
    expect(codex.byteSize).toBeGreaterThan(0);

    const listed = data(await runtime.handleCommand({ type: 'extensions/list' })) as {
      extensions: ExtensionSummary[];
    };
    const backends = listed.extensions.filter((extension) => extension.sessionBackend !== undefined);
    expect(backends.map((extension) => extension.sessionBackend?.id).sort()).toEqual(['claude-code', 'codex']);
    expect(backends).toHaveLength(2);

    const resolved = await listExtensionBackends(rootDir);
    expect(resolved.filter((backend) => backend.enabled).map((backend) => backend.declaration.id).sort()).toEqual([
      'claude-code',
      'codex',
    ]);
  });

  it('disabling one backend does not hide or disable the other', async () => {
    const { runtime, claude, codex } = await harness();
    expect((await runtime.handleCommand({
      type: 'extensions/set_enabled', extensionId: claude.extensionId, enabled: false,
    })).success).toBe(true);

    const status = data(await runtime.handleCommand({ type: 'agents/status', refresh: true })) as {
      agents: Array<{ agentId: string; state: string; reason?: string }>;
    };
    const claudeStatus = status.agents.find((agent) => agent.agentId === 'claude-code');
    const codexStatus = status.agents.find((agent) => agent.agentId === 'codex');
    expect(claudeStatus?.state).toBe('unavailable');
    expect(claudeStatus?.reason).toContain('disabled');
    expect(codexStatus?.state === 'unavailable' && codexStatus.reason?.includes('disabled')).toBe(false);

    const blocked = await runtime.handleCommand({
      type: 'session/create', input: { agentId: 'claude-code', projectPath: '/tmp/cc-stage' },
    });
    expect(failure(blocked)).toContain('agent-plugin-disabled');

    const listed = data(await runtime.handleCommand({ type: 'extensions/list' })) as {
      extensions: ExtensionSummary[];
    };
    expect(listed.extensions.find((extension) => extension.id === codex.extensionId)?.enabled).toBe(true);
  });

  it('refuses a tampered artifact and keeps the other backend installed', async () => {
    const { rootDir, runtime, claude, codex } = await harness();
    const record = await createExtensionRevisionStore(rootDir).getRecord(claude.extensionId);
    const revision = record?.revisions.find((item) => item.contentRevision === record.selectedRevision);
    if (!revision) throw new Error('claude revision missing');
    await writeFile(join(revision.packageRoot, 'dist', 'agent.mjs'), 'tampered');

    const created = await runtime.handleCommand({
      type: 'session/create', input: { agentId: 'claude-code', projectPath: '/tmp/cc-stage' },
    });
    expect(failure(created)).toContain('agent-artifact-integrity');

    const listed = data(await runtime.handleCommand({ type: 'extensions/list' })) as {
      extensions: ExtensionSummary[];
    };
    expect(listed.extensions.some((extension) => extension.id === codex.extensionId && extension.enabled)).toBe(true);
  });

  it('uninstalls one backend without a second inventory or deleting the other', async () => {
    const { runtime, claude, codex } = await harness();
    const removed = data(await runtime.handleCommand({
      type: 'extensions/uninstall', extensionId: claude.extensionId, force: true,
    })) as { state: string };
    expect(removed.state).toBe('removed');

    const listed = data(await runtime.handleCommand({ type: 'extensions/list' })) as {
      extensions: ExtensionSummary[];
    };
    expect(listed.extensions.some((extension) => extension.id === claude.extensionId)).toBe(false);
    expect(listed.extensions.some((extension) => extension.id === codex.extensionId)).toBe(true);

    expect(failure(await runtime.handleCommand({ type: 'agents/list' }))).toContain('agents-inventory-retired');
  });
});
