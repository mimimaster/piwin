import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostPush, MediaSaveData } from '@piwin/contracts';
import { buildSettingsDomainMutations } from '@piwin/contracts';
import {
  allowNetworkFetchHost,
  allowNetworkWebSearch,
  getBashAllowlist,
  getFileWriteAllowlist,
} from '@piwin/project';
import { HostRuntime } from './host-runtime.js';
import {
  getPiwinGeneralWorkspacePath,
  getPiwinProjectsPath,
  getPiwinSessionIndexPath,
} from './paths.js';
import { getSessionRecord, listSessionsForProject } from '@piwin/session';

describe('HostRuntime', () => {
  it('ADR 0027: fans out pushes to multiple sinks and isolates sink errors', async () => {
    const legacyPushes: string[] = [];
    const remotePushes: string[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      onPush: (message) => {
        legacyPushes.push(message.type);
      },
    });

    // Attach a second sink (the remote gateway connector seam).
    const detach = runtime.attachPushSink({
      id: 'remote-test',
      push: (message) => {
        remotePushes.push(message.type);
      },
    });

    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/project' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const prompted = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'hello multi-sink' },
    });
    expect(prompted, JSON.stringify(prompted)).toMatchObject({ success: true });
    await waitForPushType(legacyPushes, 'run/terminal');
    await waitForPushType(remotePushes, 'run/terminal');

    // Both sinks see the same top-level Run stream.
    expect(legacyPushes).toContain('run/updated');
    expect(legacyPushes).toContain('run/terminal');
    expect(remotePushes).toContain('run/updated');
    expect(remotePushes).toContain('run/terminal');
    expect(remotePushes).toEqual(legacyPushes);

    // Detach the remote sink; the legacy sink keeps working.
    detach();
    runtime.detachPushSink('remote-test');
    remotePushes.length = 0;
    legacyPushes.length = 0;

    const detachedPrompt = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'after detach' },
    });
    expect(detachedPrompt.success).toBe(true);
    await waitForPushType(legacyPushes, 'run/terminal');
    expect(legacyPushes).toContain('run/terminal');
    expect(remotePushes).toEqual([]);

    // The legacy sink id cannot be removed via detachPushSink.
    runtime.detachPushSink('local-sidecar');
    legacyPushes.length = 0;
    const legacyPrompt = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'legacy stays' },
    });
    expect(legacyPrompt.success).toBe(true);
    await waitForPushType(legacyPushes, 'run/terminal');
    expect(legacyPushes).toContain('run/terminal');

    await runtime.dispose();
  });

  it('handles ping and mock session prompt', async () => {
    const pushes: string[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      onPush: (message) => {
        pushes.push(message.type);
      },
    });

    const ping = await runtime.handleCommand({ id: '1', type: 'host/ping' });
    expect(ping.success).toBe(true);

    const created = await runtime.handleCommand({
      id: '2',
      type: 'session/create',
      input: { projectPath: '/tmp/project' },
    });
    expect(created.success).toBe(true);
    if (!created.success) {
      throw new Error(created.error);
    }
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const prompted = await runtime.handleCommand({
      id: '3',
      type: 'session/prompt',
      sessionId,
      input: { text: 'hello runtime' },
    });
    expect(prompted, JSON.stringify(prompted)).toMatchObject({ success: true });
    await waitForPushType(pushes, 'run/terminal');
    expect(pushes).toContain('run/terminal');

    await runtime.dispose();
  });

  it('installs an MCP registry draft at the canonical mcp.json path', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-mcp-registry-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });

    const installed = await runtime.handleCommand({
      type: 'mcp/registry-install-draft',
      serverId: 'memory',
      draft: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
    });
    expect(installed.success).toBe(true);

    const configPath = join(rootDir, 'mcp.json');
    expect((await stat(configPath)).isFile()).toBe(true);
    const raw = await readFile(configPath, 'utf8');
    expect(raw).toContain('server-memory');

    const loaded = await runtime.handleCommand({ type: 'mcp/get' });
    expect(loaded.success).toBe(true);
    if (!loaded.success) throw new Error(loaded.error);
    expect(
      (loaded.data as { document: { mcpServers: Record<string, unknown> } }).document.mcpServers,
    ).toHaveProperty('memory');

    await runtime.dispose();
  });

  it('saves media via IPC; text-only primary path-injects and never dumps base64', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-media-'));
    const textDeltas: string[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => {
        if (message.type === 'event' && message.event.type === 'message/text_delta') {
          textDeltas.push(message.event.delta);
        }
      },
    });

    const created = await runtime.handleCommand({
      id: 'create',
      type: 'session/create',
      input: { projectPath: '/tmp/project' },
    });
    expect(created.success).toBe(true);
    if (!created.success) {
      throw new Error(created.error);
    }
    const sessionId = (created.data as { sessionId: string }).sessionId;

    // 1x1 PNG
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const saved = await runtime.handleCommand({
      id: 'media',
      type: 'media/save',
      input: {
        sessionId,
        mimeType: 'image/png',
        source: 'paste',
        base64Data: pngBase64,
      },
    });
    expect(saved.success).toBe(true);
    if (!saved.success) {
      throw new Error(saved.error);
    }
    const asset = (saved.data as MediaSaveData).asset;
    expect(asset.absolutePath.startsWith(join(rootDir, 'media'))).toBe(true);
    const fileBytes = await readFile(asset.absolutePath);
    expect(fileBytes.byteLength).toBeGreaterThan(0);

    const prompted = await runtime.handleCommand({
      id: 'prompt',
      type: 'session/prompt',
      sessionId,
      input: {
        text: 'look at this',
        attachments: [
          {
            id: asset.id,
            kind: 'media',
            path: asset.absolutePath,
            mimeType: asset.mimeType,
            byteSize: asset.byteSize,
            source: 'paste',
          },
        ],
      },
    });
    expect(prompted.success).toBe(true);
    // No default model input → text-only → path inject fallback (no ImageContent).
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const joinedSoFar = textDeltas.join('');
      if (joinedSoFar.includes('[attached image]') && joinedSoFar.includes(asset.absolutePath)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const joined = textDeltas.join('');
    expect(joined).toContain('look at this');
    expect(joined).toContain('[attached image]');
    expect(joined).toContain(asset.absolutePath);
    expect(joined).not.toContain(pngBase64);

    await runtime.dispose();
  });

  it('keeps media attachments for multimodal primary (no path inject in text)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-media-vision-'));
    const { savePiwinConfig, createDefaultPiwinConfig } = await import('./config-store.js');
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'vision-p',
        protocol: 'openai-compatible',
        name: 'Vision',
        baseUrl: 'https://example.test/v1',
        models: [{ id: 'vision-m', input: ['text', 'image'] }],
      },
    ];
    config.defaultProviderId = 'vision-p';
    config.defaultModelId = 'vision-m';
    await savePiwinConfig(config, rootDir);

    const textDeltas: string[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => {
        if (message.type === 'event' && message.event.type === 'message/text_delta') {
          textDeltas.push(message.event.delta);
        }
      },
    });

    const created = await runtime.handleCommand({
      id: 'create',
      type: 'session/create',
      input: { projectPath: '/tmp/project' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const saved = await runtime.handleCommand({
      id: 'media',
      type: 'media/save',
      input: {
        sessionId,
        mimeType: 'image/png',
        source: 'paste',
        base64Data: pngBase64,
      },
    });
    expect(saved.success).toBe(true);
    if (!saved.success) throw new Error(saved.error);
    const asset = (saved.data as MediaSaveData).asset;

    const prompted = await runtime.handleCommand({
      id: 'prompt',
      type: 'session/prompt',
      sessionId,
      input: {
        text: 'look at this vision',
        attachments: [
          {
            id: asset.id,
            kind: 'media',
            path: asset.absolutePath,
            mimeType: asset.mimeType,
            byteSize: asset.byteSize,
            source: 'paste',
          },
        ],
      },
    });
    expect(prompted.success).toBe(true);
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (textDeltas.join('').includes('look at this vision')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const joined = textDeltas.join('');
    expect(joined).toContain('look at this vision');
    // Multimodal: path not injected into text; adapter would load ImageContent (mock keeps attachments).
    expect(joined).not.toContain('[attached image]');
    expect(joined).not.toContain(pngBase64);

    await runtime.dispose();
  });

  it('rejects media attachments outside the media root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-media-deny-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
    });

    const created = await runtime.handleCommand({
      id: 'create',
      type: 'session/create',
      input: { projectPath: '/tmp/project' },
    });
    expect(created.success).toBe(true);
    if (!created.success) {
      throw new Error(created.error);
    }
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const prompted = await runtime.handleCommand({
      id: 'prompt',
      type: 'session/prompt',
      sessionId,
      input: {
        text: 'evil',
        attachments: [
          {
            id: 'x',
            kind: 'media',
            path: '/etc/passwd',
            mimeType: 'image/png',
            byteSize: 12,
            source: 'paste',
          },
        ],
      },
    });
    expect(prompted.success).toBe(false);
    if (prompted.success) {
      throw new Error('expected path escape rejection');
    }
    expect(prompted.error).toMatch(/media root|escapes/i);

    await runtime.dispose();
  });

  it('requestPermission emits and resolves via permission/resolve', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-perm-'));
    let seenRequestId: string | null = null;
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => {
        if (message.type === 'permission/request') {
          seenRequestId = message.requestId;
          void runtime.handleCommand({
            id: 'resolve',
            type: 'permission/resolve',
            requestId: message.requestId,
            decision: 'allow',
          });
        }
      },
    });

    const decision = await runtime.requestPermission({
      sessionId: 'sess-1',
      action: 'network:web_search',
      detail: 'piwin',
      defaultDecision: 'ask',
    });
    expect(decision).toBe('allow');
    expect(seenRequestId).toBeTruthy();
    await runtime.dispose();
  });

  it('denies a pending permission when its run signal is aborted', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-perm-abort-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const abortController = new AbortController();
    const decisionPromise = runtime.requestPermission({
      sessionId: 'sess-abort',
      action: 'mcp:tool-call',
      detail: 'fixture/ping',
      defaultDecision: 'ask',
      signal: abortController.signal,
    });

    abortController.abort();

    await expect(decisionPromise).resolves.toBe('deny');
    await runtime.dispose();
  });

  it('skills/list returns array and set_enabled updates config', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-skills-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
    });

    const listed = await runtime.handleCommand({ id: 's1', type: 'skills/list' });
    expect(listed.success).toBe(true);
    if (!listed.success) {
      throw new Error(listed.error);
    }
    const skills = (listed.data as { skills: Array<{ id: string }> }).skills;
    expect(Array.isArray(skills)).toBe(true);

    const toggled = await runtime.handleCommand({
      id: 's2',
      type: 'skills/set_enabled',
      skillId: 'find-skill',
      enabled: false,
    });
    expect(toggled.success).toBe(true);
    if (!toggled.success) {
      throw new Error(toggled.error);
    }
    const disabledIds = (toggled.data as { disabledIds: string[] }).disabledIds;
    expect(disabledIds).toContain('find-skill');

    const mcp = await runtime.handleCommand({ id: 'm1', type: 'mcp/get' });
    expect(mcp.success).toBe(true);
    if (!mcp.success) {
      throw new Error(mcp.error);
    }
    expect((mcp.data as { document: { mcpServers: unknown } }).document.mcpServers).toEqual({});

    await runtime.dispose();
  });

  it('extensions/list installs bundled path-guard and set_enabled persists', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-ext-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
    });

    const listed = await runtime.handleCommand({ id: 'e1', type: 'extensions/list' });
    expect(listed.success).toBe(true);
    if (!listed.success) {
      throw new Error(listed.error);
    }
    const extensions = (listed.data as { extensions: Array<{ id: string }> }).extensions;
    expect(extensions.some((item) => item.id === 'path-guard')).toBe(true);

    const toggled = await runtime.handleCommand({
      id: 'e2',
      type: 'extensions/set_enabled',
      extensionId: 'path-guard',
      enabled: false,
    });
    expect(toggled.success).toBe(true);
    if (!toggled.success) {
      throw new Error(toggled.error);
    }
    expect((toggled.data as { disabledIds: string[] }).disabledIds).toContain('path-guard');

    const listedAgain = await runtime.handleCommand({ id: 'e3', type: 'extensions/list' });
    expect(listedAgain.success).toBe(true);
    if (!listedAgain.success) {
      throw new Error(listedAgain.error);
    }
    const pathGuard = (
      listedAgain.data as { extensions: Array<{ id: string; enabled: boolean }> }
    ).extensions.find((item) => item.id === 'path-guard');
    expect(pathGuard?.enabled).toBe(false);

    const validated = await runtime.handleCommand({
      id: 'm2',
      type: 'mcp/validate',
      document: {
        mcpServers: {
          memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
        },
      },
    });
    expect(validated.success).toBe(true);
    if (!validated.success) {
      throw new Error(validated.error);
    }
    expect((validated.data as { valid: boolean }).valid).toBe(true);

    await runtime.dispose();
  });

  it('git/status returns repository snapshot for this repo', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-git-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
    });

    // Use the monorepo path (this workspace is a git repo).
    const projectPath = process.cwd().includes('packages/agent-host')
      ? join(process.cwd(), '../..')
      : process.cwd();

    const status = await runtime.handleCommand({
      id: 'g1',
      type: 'git/status',
      projectPath,
    });
    expect(status.success).toBe(true);
    if (!status.success) {
      throw new Error(status.error);
    }
    const snapshot = (status.data as { snapshot: { repository: { isRepository: boolean } } })
      .snapshot;
    expect(snapshot.repository.isRepository).toBe(true);

    const graph = await runtime.handleCommand({
      id: 'g2',
      type: 'git/log-graph',
      projectPath,
      limit: 5,
    });
    expect(graph.success).toBe(true);
    if (!graph.success) {
      throw new Error(graph.error);
    }
    const nodes = (graph.data as { graph: { nodes: unknown[] } }).graph.nodes;
    expect(Array.isArray(nodes)).toBe(true);

    await runtime.dispose();
  });

  it('git/branch-list returns local branches for this repo', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-git-branches-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
    });

    const projectPath = process.cwd().includes('packages/agent-host')
      ? join(process.cwd(), '../..')
      : process.cwd();

    const listed = await runtime.handleCommand({
      id: 'g-branches',
      type: 'git/branch-list',
      projectPath,
      limit: 20,
    });
    expect(listed.success).toBe(true);
    if (!listed.success) {
      throw new Error(listed.error);
    }
    const branches = (listed.data as { branches: { branches: Array<{ name: string }> } }).branches;
    expect(Array.isArray(branches.branches)).toBe(true);
    expect(branches.branches.length).toBeGreaterThan(0);

    await runtime.dispose();
  });

  it('persists transcript and hydrates on resume across runtime instances', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-transcript-'));
    const runtimeA = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
    });

    const created = await runtimeA.handleCommand({
      id: 'create',
      type: 'session/create',
      input: { projectPath: '/tmp/resume-project', sessionName: 'resume-demo' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const prompted = await runtimeA.handleCommand({
      id: 'prompt',
      type: 'session/prompt',
      sessionId,
      input: { text: 'hello after create' },
    });
    expect(prompted.success).toBe(true);
    // allow mock stream + transcript flushes
    await new Promise((resolve) => setTimeout(resolve, 80));
    await runtimeA.dispose();

    const runtimeB = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
    });
    const resumed = await runtimeB.handleCommand({
      id: 'resume',
      type: 'session/resume',
      sessionId,
    });
    expect(resumed.success).toBe(true);
    if (!resumed.success) throw new Error(resumed.error);
    const data = resumed.data as {
      sessionId: string;
      live: boolean;
      messages: Array<{ text: string; role: string }>;
    };
    expect(data.sessionId).toBe(sessionId);
    expect(data.live).toBe(true);
    expect(data.messages.some((message) => message.role === 'user')).toBe(true);
    expect(data.messages.some((message) => message.text.includes('hello after create'))).toBe(true);

    const listed = await runtimeB.handleCommand({
      id: 'msgs',
      type: 'session/messages',
      sessionId,
    });
    expect(listed.success).toBe(true);
    await runtimeB.dispose();
  });

  it('supports manual session compaction on mock sessions', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-compact-'));
    const events: string[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => {
        if (message.type === 'event') {
          events.push(message.event.type);
        }
      },
    });
    const created = await runtime.handleCommand({
      id: 'c1',
      type: 'session/create',
      input: { projectPath: '/tmp/compact-project' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const compacted = await runtime.handleCommand({
      id: 'c2',
      type: 'session/compact',
      sessionId,
      customInstructions: 'keep recent tools',
    });
    expect(compacted.success).toBe(true);
    if (!compacted.success) throw new Error(compacted.error);
    const data = compacted.data as { ok: boolean; message?: string };
    expect(data.ok).toBe(true);
    expect(events).toContain('compaction/start');
    expect(events).toContain('compaction/end');

    const settings = await runtime.handleCommand({
      id: 'c3',
      type: 'session/compaction-settings',
      sessionId,
    });
    expect(settings.success).toBe(true);
    if (!settings.success) throw new Error(settings.error);
    expect((settings.data as { supported: boolean }).supported).toBe(true);

    await runtime.dispose();
  });

  it('persists and approves a session plan artifact', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-plan-'));
    const pushes: string[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => pushes.push(message.type),
    });
    await runtime.handleCommand({
      id: 'p0',
      type: 'project/open',
      path: '/tmp/plan-project',
    });
    const created = await runtime.handleCommand({
      id: 'p1',
      type: 'session/create',
      input: { projectPath: '/tmp/plan-project', sessionName: 'plan-demo' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const now = new Date().toISOString();
    const plan = {
      id: 'plan-1',
      sessionId,
      projectPath: '/tmp/plan-project',
      status: 'draft' as const,
      title: 'Demo',
      goal: 'Prove plan IPC',
      steps: [{ id: '1', title: 'Write plan', status: 'pending' as const }],
      revision: 0,
      createdAt: now,
      updatedAt: now,
      source: 'user' as const,
    };
    const setResult = await runtime.handleCommand({
      id: 'p2',
      type: 'plan/set',
      sessionId,
      plan,
    });
    expect(setResult.success).toBe(true);
    if (!setResult.success) throw new Error(setResult.error);
    const approved = await runtime.handleCommand({
      id: 'p3',
      type: 'plan/approve',
      sessionId,
    });
    expect(approved.success).toBe(true);
    if (!approved.success) throw new Error(approved.error);
    expect((approved.data as { plan: { status: string } }).plan.status).toBe('approved');
    expect(pushes).toContain('plan/updated');
    await runtime.dispose();
  });

  it('rejects plan/execute when no plan exists', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-plan-exec-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    await runtime.handleCommand({ type: 'project/open', path: '/tmp/plan-exec' });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/plan-exec' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const result = await runtime.handleCommand({
      type: 'plan/execute',
      request: { sessionId, planId: 'missing', mode: 'inline' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('No plan');
    }
    await runtime.dispose();
  });

  it('rejects plan/execute when plan is not approved', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-plan-draft-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    await runtime.handleCommand({ type: 'project/open', path: '/tmp/plan-draft' });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/plan-draft' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const now = new Date().toISOString();
    await runtime.handleCommand({
      type: 'plan/set',
      sessionId,
      plan: {
        id: 'p1',
        sessionId,
        projectPath: '/tmp/plan-draft',
        status: 'draft',
        title: 'T',
        goal: 'G',
        steps: [{ id: '1', title: 'A', status: 'pending' }],
        revision: 0,
        createdAt: now,
        updatedAt: now,
        source: 'user',
      },
    });
    const result = await runtime.handleCommand({
      type: 'plan/execute',
      request: { sessionId, planId: 'p1', mode: 'inline' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('approved');
    }
    await runtime.dispose();
  });

  it('starts inline execution after approval and pushes execution-updated', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-plan-inline-'));
    const pushes: string[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => pushes.push(message.type),
    });
    await runtime.handleCommand({ type: 'project/open', path: '/tmp/plan-inline' });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/plan-inline' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const now = new Date().toISOString();
    await runtime.handleCommand({
      type: 'plan/set',
      sessionId,
      plan: {
        id: 'p1',
        sessionId,
        projectPath: '/tmp/plan-inline',
        status: 'draft',
        title: 'T',
        goal: 'G',
        steps: [{ id: '1', title: 'A', status: 'pending' }],
        revision: 0,
        createdAt: now,
        updatedAt: now,
        source: 'user',
      },
    });
    await runtime.handleCommand({ type: 'plan/approve', sessionId });
    const result = await runtime.handleCommand({
      type: 'plan/execute',
      request: { sessionId, planId: 'p1', mode: 'inline' },
    });
    expect(result.success).toBe(true);
    expect(pushes).toContain('plan/execution-updated');
    await runtime.dispose();
  });

  it('inherits global auto-compact default and session override source', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-auto-compact-'));
    const { savePiwinConfig, createDefaultPiwinConfig } = await import('./config-store.js');
    const config = createDefaultPiwinConfig();
    config.compaction = { autoEnabledDefault: false };
    await savePiwinConfig(config, rootDir);

    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/auto-c' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    // Allow async applyAutoCompactionToSession to settle
    await new Promise((resolve) => setTimeout(resolve, 20));

    const settings = await runtime.handleCommand({
      type: 'session/compaction-settings',
      sessionId,
    });
    expect(settings.success).toBe(true);
    if (!settings.success) throw new Error(settings.error);
    const data = settings.data as {
      source?: string;
      globalDefault?: boolean;
      autoCompactionEnabled: boolean;
    };
    expect(data.globalDefault).toBe(false);
    expect(data.source).toBe('global');
    expect(data.autoCompactionEnabled).toBe(false);

    const overridden = await runtime.handleCommand({
      type: 'session/set-auto-compaction',
      sessionId,
      enabled: true,
    });
    expect(overridden.success).toBe(true);
    const after = await runtime.handleCommand({
      type: 'session/compaction-settings',
      sessionId,
    });
    expect(after.success).toBe(true);
    if (!after.success) throw new Error(after.error);
    expect((after.data as { source?: string }).source).toBe('session');
    expect((after.data as { autoCompactionEnabled: boolean }).autoCompactionEnabled).toBe(true);

    await runtime.dispose();
  });

  it('updates plan steps via plan/update-step and auto-completes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-plan-step-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    await runtime.handleCommand({ type: 'project/open', path: '/tmp/plan-step' });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/plan-step' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const now = new Date().toISOString();
    await runtime.handleCommand({
      type: 'plan/set',
      sessionId,
      plan: {
        id: 'p1',
        sessionId,
        projectPath: '/tmp/plan-step',
        status: 'draft',
        title: 'T',
        goal: 'G',
        steps: [
          { id: '1', title: 'A', status: 'pending' },
          { id: '2', title: 'B', status: 'pending' },
        ],
        revision: 0,
        createdAt: now,
        updatedAt: now,
        source: 'user',
      },
    });
    await runtime.handleCommand({ type: 'plan/approve', sessionId });

    const step1 = await runtime.handleCommand({
      type: 'plan/update-step',
      sessionId,
      stepId: '1',
      status: 'done',
    });
    expect(step1.success).toBe(true);
    if (!step1.success) throw new Error(step1.error);
    expect((step1.data as { plan: { status: string } }).plan.status).toBe('executing');

    const step2 = await runtime.handleCommand({
      type: 'plan/update-step',
      sessionId,
      stepId: '2',
      status: 'done',
    });
    expect(step2.success).toBe(true);
    if (!step2.success) throw new Error(step2.error);
    expect((step2.data as { plan: { status: string } }).plan.status).toBe('done');

    await runtime.dispose();
  });

  it('extension UI bridge request resolves via extension/ui_resolve', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-extui-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
    });

    const pending = runtime.requestExtensionUi({
      sessionId: 'sess-ext',
      requestId: 'ext-req-1',
      kind: 'confirm',
      title: 'Allow path-guard override?',
      message: 'Write to .env',
    });

    const resolved = await runtime.handleCommand({
      id: 'r1',
      type: 'extension/ui_resolve',
      requestId: 'ext-req-1',
      confirmed: true,
    });
    expect(resolved.success).toBe(true);

    await expect(pending).resolves.toEqual({ kind: 'confirm', confirmed: true });
    await runtime.dispose();
  });

  it('stop resolves a pending extension UI request and emits a terminal event', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-extui-stop-'));
    const pushes: HostPush[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      testFixture: 'hang-until-abort',
      onPush: (message) => pushes.push(message),
    });

    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/extui-stop-project' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const prompted = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'start a cancellable run' },
    });
    expect(prompted.success).toBe(true);
    if (!prompted.success) throw new Error(prompted.error);
    const runId = (prompted.data as { runId: string }).runId;

    const pendingUi = runtime.requestExtensionUi({
      sessionId,
      requestId: 'ext-stop-1',
      kind: 'select',
      title: 'Choose an option',
      options: ['one', 'two'],
    });

    const aborted = await runtime.handleCommand({
      type: 'session/abort',
      sessionId,
      runId,
    });
    expect(aborted).toMatchObject({
      success: true,
      data: { cancelled: true, runId },
    });
    await expect(pendingUi).resolves.toEqual({ kind: 'select', cancelled: true });

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const terminal = pushes.find(
        (push) =>
          push.type === 'run/terminal' &&
          push.run.sessionId === sessionId &&
          push.run.runId === runId,
      );
      if (terminal) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(
      pushes.some(
        (push) =>
          push.type === 'run/terminal' &&
          push.run.sessionId === sessionId &&
          push.run.runId === runId &&
          push.run.status === 'cancelled',
      ),
    ).toBe(true);

    await runtime.dispose();
  });

  it('cron/run respects automation.enabled and cronEnabled gates', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-cron-gate-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });

    const job = {
      id: 'cron-test-1',
      name: 'gate-test',
      enabled: true,
      schedule: 'every:1m',
      type: 'prompt' as const,
      promptText: 'hello',
      projectPath: '/tmp/project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const upserted = await runtime.handleCommand({ type: 'cron/upsert', job });
    expect(upserted.success).toBe(true);

    const blockedMaster = await runtime.handleCommand({ type: 'cron/run', jobId: job.id });
    expect(blockedMaster.success).toBe(true);
    if (!blockedMaster.success) throw new Error(blockedMaster.error);
    expect((blockedMaster.data as { ok: boolean; message?: string }).ok).toBe(false);
    expect((blockedMaster.data as { message?: string }).message).toMatch(/automation disabled/i);

    const cfgRes = await runtime.handleCommand({ type: 'settings/get' });
    expect(cfgRes.success).toBe(true);
    if (!cfgRes.success) throw new Error(cfgRes.error);
    const snapshot = (
      cfgRes.data as {
        snapshot: { config: import('@piwin/contracts').PiwinConfig; revision: string };
      }
    ).snapshot;
    const config = snapshot.config;
    const enabledOnly = await runtime.handleCommand({
      type: 'settings/apply',
      input: {
        expectedRevision: snapshot.revision,
        mutations: buildSettingsDomainMutations(config, {
          ...config,
          automation: { enabled: true, cronEnabled: false, hooksEnabled: false },
        }),
      },
    });
    expect(enabledOnly.success).toBe(true);

    const blockedCron = await runtime.handleCommand({ type: 'cron/run', jobId: job.id });
    expect(blockedCron.success).toBe(true);
    if (!blockedCron.success) throw new Error(blockedCron.error);
    expect((blockedCron.data as { ok: boolean; message?: string }).ok).toBe(false);
    expect((blockedCron.data as { message?: string }).message).toMatch(/cron disabled/i);

    await runtime.dispose();
  });

  it('session rename/archive/delete follows archive-first policy', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-sess-lifecycle-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });

    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/lifecycle-project', sessionName: 'Original' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const renamed = await runtime.handleCommand({
      type: 'session/rename',
      sessionId,
      name: '  Renamed Agent  ',
    });
    expect(renamed.success).toBe(true);
    expect((renamed as { data: { name: string } }).data.name).toBe('Renamed Agent');

    const activeList = await runtime.handleCommand({
      type: 'session/list',
      projectPath: '/tmp/lifecycle-project',
    });
    expect(activeList.success).toBe(true);
    expect(
      (activeList as { data: { sessions: { id: string; name?: string }[] } }).data.sessions.map(
        (item) => item.name,
      ),
    ).toContain('Renamed Agent');

    const deleteTooSoon = await runtime.handleCommand({
      type: 'session/delete',
      sessionId,
    });
    expect(deleteTooSoon.success).toBe(false);

    const archived = await runtime.handleCommand({ type: 'session/archive', sessionId });
    expect(archived.success).toBe(true);

    const afterArchive = await runtime.handleCommand({
      type: 'session/list',
      projectPath: '/tmp/lifecycle-project',
    });
    expect(
      (afterArchive as { data: { sessions: { id: string }[] } }).data.sessions.map(
        (item) => item.id,
      ),
    ).not.toContain(sessionId);

    const withArchived = await runtime.handleCommand({
      type: 'session/list',
      projectPath: '/tmp/lifecycle-project',
      includeArchived: true,
    });
    expect(
      (
        withArchived as { data: { sessions: { id: string; isArchived?: boolean }[] } }
      ).data.sessions.some((item) => item.id === sessionId && item.isArchived === true),
    ).toBe(true);

    // Seed session media vault — permanent delete must remove it with the session.
    const mediaSessionDir = join(rootDir, 'media', sessionId);
    await mkdir(mediaSessionDir, { recursive: true });
    await writeFile(join(mediaSessionDir, 'seed.png'), Buffer.from('png'));
    expect((await stat(join(mediaSessionDir, 'seed.png'))).isFile()).toBe(true);

    const deleted = await runtime.handleCommand({ type: 'session/delete', sessionId });
    expect(deleted.success).toBe(true);

    await expect(stat(mediaSessionDir)).rejects.toMatchObject({ code: 'ENOENT' });

    const finalList = await runtime.handleCommand({
      type: 'session/list',
      projectPath: '/tmp/lifecycle-project',
      includeArchived: true,
    });
    expect(
      (finalList as { data: { sessions: { id: string }[] } }).data.sessions.map((item) => item.id),
    ).not.toContain(sessionId);

    await runtime.dispose();
  });

  it('session/duplicate copies product transcript into a new session', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-dup-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });

    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/dup-project', sessionName: 'Source Chat' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sourceId = (created.data as { sessionId: string }).sessionId;

    const prompted = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId: sourceId,
      input: { text: 'remember this for the fork' },
    });
    expect(prompted.success).toBe(true);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const messages = await runtime.handleCommand({
        type: 'session/messages',
        sessionId: sourceId,
      });
      if (
        messages.success &&
        (messages.data as { messages: Array<{ role: string }> }).messages.some(
          (message) => message.role === 'user',
        )
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const duplicated = await runtime.handleCommand({
      type: 'session/duplicate',
      sessionId: sourceId,
    });
    expect(duplicated.success).toBe(true);
    if (!duplicated.success) throw new Error(duplicated.error);
    const data = duplicated.data as {
      sessionId: string;
      sourceSessionId: string;
      session: { name?: string; messageCount: number };
      messages: Array<{ text: string; role: string }>;
    };
    expect(data.sourceSessionId).toBe(sourceId);
    expect(data.sessionId).not.toBe(sourceId);
    expect(data.session.name).toBe('Copy of Source Chat');
    expect(data.messages.some((message) => message.role === 'user')).toBe(true);

    const listed = await runtime.handleCommand({
      type: 'session/list',
      projectPath: '/tmp/dup-project',
    });
    expect(listed.success).toBe(true);
    if (!listed.success) throw new Error(listed.error);
    const sessions = (listed.data as { sessions: Array<{ id: string }> }).sessions;
    expect(sessions.map((item) => item.id).sort()).toEqual([sourceId, data.sessionId].sort());

    await runtime.dispose();
  });

  it('lists and revokes project remembered permissions', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-perms-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const projectPath = join(rootDir, 'workspace');
    await runtime.handleCommand({ type: 'project/open', path: projectPath });
    await runtime.handleCommand({ type: 'project/trust', path: projectPath });

    const projectsPath = getPiwinProjectsPath(rootDir);
    await allowNetworkWebSearch(projectsPath, projectPath);
    await allowNetworkFetchHost(projectsPath, projectPath, 'example.com');

    const listed = await runtime.handleCommand({
      type: 'project/permissions-list',
      path: projectPath,
    });
    expect(listed.success).toBe(true);
    if (!listed.success) throw new Error(listed.error);
    const keys = (listed.data as { permissions: Array<{ key: string }> }).permissions.map(
      (item) => item.key,
    );
    expect(keys.sort()).toEqual(['network:fetch:example.com', 'network:web_search']);

    const revoked = await runtime.handleCommand({
      type: 'project/permissions-revoke',
      path: projectPath,
      key: 'network:web_search',
    });
    expect(revoked.success).toBe(true);
    if (!revoked.success) throw new Error(revoked.error);
    const afterKeys = (revoked.data as { permissions: Array<{ key: string }> }).permissions.map(
      (item) => item.key,
    );
    expect(afterKeys).not.toContain('network:web_search');

    await runtime.dispose();
  });

  it('remembers bash allow rules with exact command match on project-scoped allow', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-bash-remember-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => {
        if (message.type === 'permission/request') {
          void runtime.handleCommand({
            id: 'resolve',
            type: 'permission/resolve',
            requestId: message.requestId,
            decision: 'allow',
            rememberScope: 'project',
          });
        }
      },
    });
    const projectPath = join(rootDir, 'bash-project');
    await runtime.handleCommand({ type: 'project/open', path: projectPath });

    // Detail format from the parent-owned bash registration is `<reason>: <command>`. The command
    // after `: ` is what gets remembered, verbatim.
    const decision = await runtime.requestPermission({
      sessionId: 'sess-bash',
      projectPath,
      action: 'bash',
      detail: 'rm-recursive: rm -rf /tmp/foo',
      defaultDecision: 'ask',
    });
    expect(decision).toBe('allow');

    const projectsPath = getPiwinProjectsPath(rootDir);
    const allowlist = await getBashAllowlist(projectsPath, projectPath);
    expect(allowlist).toContain('rm -rf /tmp/foo');
    // Exact match only: a prefix-ish command must not be present.
    expect(allowlist).not.toContain('rm -rf /tmp/foo /etc');
    await runtime.dispose();
  });

  it('remembers file-write allow rules with the resolved absolute path', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-file-remember-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => {
        if (message.type === 'permission/request') {
          void runtime.handleCommand({
            id: 'resolve',
            type: 'permission/resolve',
            requestId: message.requestId,
            decision: 'allow',
            rememberScope: 'project',
          });
        }
      },
    });
    const projectPath = join(rootDir, 'file-project');
    await runtime.handleCommand({ type: 'project/open', path: projectPath });

    const absPath = join(rootDir, 'outside.txt');
    const decision = await runtime.requestPermission({
      sessionId: 'sess-file',
      projectPath,
      action: 'file-write',
      detail: absPath,
      defaultDecision: 'ask',
    });
    expect(decision).toBe('allow');

    const projectsPath = getPiwinProjectsPath(rootDir);
    const allowlist = await getFileWriteAllowlist(projectsPath, projectPath);
    expect(allowlist).toContain(absPath);
    await runtime.dispose();
  });

  it('does not remember bash allow rules when no project path is present', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-bash-noproject-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => {
        if (message.type === 'permission/request') {
          void runtime.handleCommand({
            id: 'resolve',
            type: 'permission/resolve',
            requestId: message.requestId,
            decision: 'allow',
            rememberScope: 'project',
          });
        }
      },
    });
    // No projectPath supplied → general scope, nothing to remember.
    const decision = await runtime.requestPermission({
      sessionId: 'sess-general',
      action: 'bash',
      detail: 'rm-recursive: rm -rf /tmp/foo',
      defaultDecision: 'ask',
    });
    expect(decision).toBe('allow');
    await runtime.dispose();
  });

  it('creates general sessions without project open/trust and isolates lists', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-general-'));
    const textDeltas: string[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => {
        if (message.type === 'event' && message.event.type === 'message/text_delta') {
          textDeltas.push(message.event.delta);
        }
      },
    });

    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { scope: { kind: 'general' } },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const runtimeStatus = await runtime.handleCommand({
      type: 'session/runtime-status',
      sessionId,
    });
    expect(runtimeStatus.success).toBe(true);
    if (!runtimeStatus.success) throw new Error(runtimeStatus.error);
    expect(
      (runtimeStatus.data as { status: { state: string; generationId?: string } }).status,
    ).toMatchObject({ state: 'live' });
    expect(
      (runtimeStatus.data as { status: { generationId?: string } }).status.generationId,
    ).toMatch(/^generation-/);

    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = await getSessionRecord(indexPath, sessionId);
    expect(record?.scope).toEqual({ kind: 'general' });
    expect(record?.workingDirectory).toBe(getPiwinGeneralWorkspacePath(rootDir));
    expect(record?.projectPath).toBe('');

    const workspaceStats = await stat(getPiwinGeneralWorkspacePath(rootDir));
    expect(workspaceStats.isDirectory()).toBe(true);

    const prompted = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'hello general' },
    });
    expect(prompted.success).toBe(true);

    // Wait for mock stream chunks
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(textDeltas.join('')).toContain('hello general');

    const generalList = await runtime.handleCommand({
      type: 'session/list',
      scope: { kind: 'general' },
    });
    expect(generalList.success).toBe(true);
    if (!generalList.success) throw new Error(generalList.error);
    const generalSessions = (generalList.data as { sessions: Array<{ id: string }> }).sessions;
    expect(generalSessions.some((item) => item.id === sessionId)).toBe(true);

    // Project list must not include general sessions
    const projectList = await runtime.handleCommand({
      type: 'session/list',
      projectPath: '/tmp/some-project',
    });
    expect(projectList.success).toBe(true);
    if (!projectList.success) throw new Error(projectList.error);
    const projectSessions = (projectList.data as { sessions: Array<{ id: string }> }).sessions;
    expect(projectSessions.some((item) => item.id === sessionId)).toBe(false);

    const fromStore = await listSessionsForProject(indexPath, { kind: 'general' });
    expect(fromStore.map((item) => item.id)).toContain(sessionId);

    await runtime.dispose();
  });

  it('warns when session index write fails', async () => {
    // Create a piwinRoot where sessions-index is a FILE, not a directory,
    // so upsertSessionRecord fails with ENOTDIR.
    const badRoot = await mkdtemp(join(tmpdir(), 'piwin-bad-root-'));
    await writeFile(join(badRoot, 'sessions-index'), 'blocker');
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: string) => warnings.push(message);
    try {
      const runtime = new HostRuntime({
        mode: 'sdk',
        mock: true,
        piwinRoot: badRoot,
      });
      // session/create → PiSdkAdapter.createSession → persistSessionMeta →
      // upsertSessionRecord. With sessions-index as a file, the write fails
      // and should warn via console.warn instead of crashing.
      const result = await runtime.handleCommand({
        type: 'session/create',
        input: {
          projectPath: '/tmp/piwin-test-project',
        },
      });
      // The session creation should succeed (index write is best-effort).
      expect(result.success).toBe(true);
      const indexWarn = warnings.find((message) => message.includes('session index'));
      expect(indexWarn).toBeDefined();
      await runtime.dispose();
    } finally {
      console.warn = originalWarn;
    }
  });
});

async function waitForPushType(pushes: string[], type: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (pushes.includes(type)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for push type ${type}`);
}
