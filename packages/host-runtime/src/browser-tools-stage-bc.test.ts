import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostToolRegistration, ToolResult } from '@piwin/contracts';
import { isHostToolPermissionAction } from '@piwin/contracts';
import type { BrowserSession } from '@piwin/browser';
import { createBrowserToolDefinitions } from './browser-tools.js';
import { createBundledRuleSet } from './permission-defaults.js';
import { createHostToolAdmission } from './tools/tool-admission.js';
import { HostToolExecutionRouter } from './tools/host-tool-execution-router.js';

function createExclusiveQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(() => operation());
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  return { runExclusive };
}

function createMockSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  const calls: { method: string; args: unknown[] }[] = [];
  const queue = createExclusiveQueue();
  const session: BrowserSession = {
    start: async () => ({}),
    stop: async () => {},
    navigate: async () => {},
    snapshot: async () => [],
    click: async () => {},
    hover: async (target, options) => {
      calls.push({ method: 'hover', args: [target, options] });
    },
    selectOption: async (target, values, options) => {
      calls.push({ method: 'selectOption', args: [target, values, options] });
    },
    setChecked: async (target, checked, options) => {
      calls.push({ method: 'setChecked', args: [target, checked, options] });
    },
    uploadFiles: async (target, files, options) => {
      calls.push({ method: 'uploadFiles', args: [target, files, options] });
    },
    listTabs: async () => {
      calls.push({ method: 'listTabs', args: [] });
      return [
        { pageId: 'p-1-1', url: 'https://a.example', title: 'A', kind: 'page', active: true },
        { pageId: 'p-1-2', url: 'https://popup.example', title: 'P', kind: 'popup', active: false },
      ];
    },
    newTab: async (url, options) => {
      calls.push({ method: 'newTab', args: [url, options] });
      return {
        pageId: 'p-1-3',
        url: url ?? 'about:blank',
        title: '',
        kind: 'page',
        active: true,
      };
    },
    selectTab: async (pageId) => {
      calls.push({ method: 'selectTab', args: [pageId] });
      return { pageId, url: 'https://a.example', title: 'A', kind: 'page', active: true };
    },
    closeTab: async () => {},
    handleDialog: async (action) => {
      calls.push({ method: 'handleDialog', args: [action] });
      return { pageId: 'p-1-1', type: 'alert', message: 'hi', timedOut: false };
    },
    pendingDialog: () => undefined,
    queryConsole: () => [{ level: 'error', text: 'boom', url: 'https://a.example', ts: 1 }],
    queryNetwork: () => [
      {
        method: 'GET',
        url: 'https://a.example/x',
        status: 200,
        resourceType: 'xhr',
        duration: 3,
        failed: false,
        ts: 1,
      },
    ],
    queryDownloads: () => [
      { filename: 'report.csv', path: '/tmp/host/report.csv', url: 'https://a.example/report.csv', ts: 1 },
    ],
    ownership: () => 'owned',
    type: async () => {},
    fillForm: async () => {},
    scroll: async () => {},
    screenshot: async () => ({ dataUrl: 'data:image/jpeg;base64,AA==', width: 1, height: 1 }),
    back: async () => {},
    forward: async () => {},
    find: async () => ({ count: 0, candidates: [], truncated: false }),
    wait: async () => {},
    waitFor: async () => {},
    reload: async () => {},
    pressKey: async () => {},
    currentTarget: () => ({ generation: 1, pageId: 'page-1', documentRevision: 0 }),
    capture: async () => ({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      mime: 'image/jpeg',
      width: 1280,
      height: 800,
      encodedWidth: 1280,
      encodedHeight: 800,
    }),
    queryViewport: () => ({ width: 1280, height: 800 }),
    applyViewport: async (size) => size,
    status: () => ({
      lifecycle: 'ready',
      mirror: 'off',
      generation: 1,
      pageStateLost: false,
      recoveryCount: 0,
      pageId: 'p-1-1',
    }),
    restart: async () => ({ pageStateLost: true, generation: 2 }),
    pickElementAt: async () => ({
      url: 'https://a.example',
      selector: 'button',
      text: 'x',
      boundingRect: { x: 0, y: 0, width: 1, height: 1 },
    }),
    dispatchInput: async () => {},
    setViewport: async (size) => size,
    mirrorLeaseCount: () => 1,
    hasMirrorLease: () => true,
    takeOver: async () => ({ owner: 'user', agentWantsLock: true }),
    giveBack: async () => ({ owner: 'idle', agentWantsLock: false }),
    lock: async (owner) => ({ owner, agentWantsLock: owner === 'agent' }),
    unlock: async () => ({ owner: 'idle', agentWantsLock: false }),
    releaseAgentControl: async () => {},
    releaseAgentControlIfHeldBy: async () => {},
    controllerState: () => ({ owner: 'idle', agentWantsLock: false }),
    runExclusive: queue.runExclusive,
    subscribe: () => () => {},
    currentState: () => ({ url: 'https://a.example' }),
    close: async () => {},
    ...overrides,
  };
  return Object.assign(session, { calls });
}

async function executeTool(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return tool.execute(args, new AbortController().signal, {
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolName: tool.descriptor.name,
  });
}

function outputOf(result: ToolResult): string {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.output;
}

async function executeThroughAdmission(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const admission = createHostToolAdmission({
    rules: createBundledRuleSet(),
    getPermissionMode: () => 'auto',
    projectRoot: '/tmp',
  });
  const router = new HostToolExecutionRouter({ tools: [tool], admission });
  return router.execute(tool.descriptor.name, args, new AbortController().signal, {
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolName: tool.descriptor.name,
  });
}

function sessionCalls(session: BrowserSession): { method: string; args: unknown[] }[] {
  return (session as unknown as { calls: { method: string; args: unknown[] }[] }).calls;
}

describe('stage B/C browser tools', () => {
  it('uses known permission actions', () => {
    const tools = createBrowserToolDefinitions(createMockSession());
    for (const tool of tools) {
      expect(isHostToolPermissionAction(tool.permissionSpec.action)).toBe(true);
    }
  });

  it('delegates hover, select-option, and set-checked', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const hover = tools.find((tool) => tool.descriptor.name === 'browser_hover');
    const select = tools.find((tool) => tool.descriptor.name === 'browser_select_option');
    const check = tools.find((tool) => tool.descriptor.name === 'browser_set_checked');
    if (!hover || !select || !check) throw new Error('interaction tools missing');
    expect((await executeTool(hover, { selector: '#menu' })).ok).toBe(true);
    expect((await executeTool(select, { selector: '#sel', value: 'one' })).ok).toBe(true);
    expect((await executeTool(check, { selector: '#box', checked: false })).ok).toBe(true);
    const calls = (session as unknown as { calls: { method: string }[] }).calls;
    expect(calls.map((call) => call.method)).toEqual(['hover', 'selectOption', 'setChecked']);
  });

  it('rejects file: URLs on browser_tabs new before opening a page', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const tabs = tools.find((tool) => tool.descriptor.name === 'browser_tabs');
    if (!tabs) throw new Error('browser_tabs missing');
    const prepared = await tabs.prepareArgs?.(
      { action: 'new', url: 'file:///etc/passwd' },
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'g',
        runId: 'run-1',
        toolName: 'browser_tabs',
      },
      new AbortController().signal,
    );
    expect(prepared).toMatchObject({
      ok: false,
      result: { ok: false, code: 'invalid-input', message: expect.stringContaining('http(s)') },
    });
    const result = await executeThroughAdmission(tabs, { action: 'new', url: 'file:///etc/passwd' });
    expect(result).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(sessionCalls(session).some((call) => call.method === 'newTab')).toBe(false);
  });

  it('does not let browser_tabs new open link-local metadata without navigate permission', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const tabs = tools.find((tool) => tool.descriptor.name === 'browser_tabs');
    if (!tabs) throw new Error('browser_tabs missing');
    const result = await executeThroughAdmission(tabs, {
      action: 'new',
      url: 'http://169.254.169.254/latest/meta-data/',
    });
    expect(result).toMatchObject({ ok: false, code: 'permission-denied' });
    expect(sessionCalls(session).some((call) => call.method === 'newTab')).toBe(false);
  });

  it('lists popups without treating them as the active tab', async () => {
    const tools = createBrowserToolDefinitions(createMockSession());
    const tabs = tools.find((tool) => tool.descriptor.name === 'browser_tabs');
    if (!tabs) throw new Error('browser_tabs missing');
    const result = await executeTool(tabs, { action: 'list' });
    const parsed = JSON.parse(outputOf(result)) as {
      tabs: Array<{ pageId: string; kind: string; active: boolean }>;
    };
    expect(parsed.tabs).toEqual([
      expect.objectContaining({ pageId: 'p-1-1', kind: 'page', active: true }),
      expect.objectContaining({ pageId: 'p-1-2', kind: 'popup', active: false }),
    ]);
  });

  it('maps a dialog timeout to browser-action-failed', async () => {
    const session = createMockSession({
      handleDialog: async () => {
        throw new Error('dialog timed out');
      },
    });
    const tools = createBrowserToolDefinitions(session);
    const dialog = tools.find((tool) => tool.descriptor.name === 'browser_dialog');
    if (!dialog) throw new Error('browser_dialog missing');
    const result = await executeTool(dialog, { action: 'dismiss' });
    expect(result).toMatchObject({
      ok: false,
      code: 'browser-action-failed',
      details: { reason: 'timeout' },
    });
  });

  it('gates upload to an existing Host path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-upload-'));
    const path = join(dir, 'note.txt');
    await writeFile(path, 'hi');
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session, { projectRoot: dir });
    const upload = tools.find((tool) => tool.descriptor.name === 'browser_upload');
    if (!upload) throw new Error('browser_upload missing');
    expect(upload.permissionSpec.action).toBe('browser:upload');
    const prepared = await upload.prepareArgs?.(
      { selector: 'input[type=file]', path: 'note.txt' },
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'g',
        runId: 'run-1',
        toolName: 'browser_upload',
      },
      new AbortController().signal,
    );
    if (!prepared || prepared.ok !== true) throw new Error('expected upload prepare to succeed');
    const result = await executeTool(upload, prepared.arguments);
    expect(result.ok).toBe(true);
    const missing = await upload.prepareArgs?.(
      { selector: 'input[type=file]', path: 'missing.txt' },
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'g',
        runId: 'run-1',
        toolName: 'browser_upload',
      },
      new AbortController().signal,
    );
    expect(missing).toMatchObject({ ok: false, result: { code: 'invalid-input' } });
  });

  it('returns bounded console, network, and download refs', async () => {
    const tools = createBrowserToolDefinitions(createMockSession());
    const consoleTool = tools.find((tool) => tool.descriptor.name === 'browser_console');
    const networkTool = tools.find((tool) => tool.descriptor.name === 'browser_network');
    if (!consoleTool || !networkTool) throw new Error('query tools missing');
    expect(consoleTool.permissionSpec.readOnly).toBe(true);
    expect(networkTool.permissionSpec.readOnly).toBe(true);
    const consoleResult = JSON.parse(outputOf(await executeTool(consoleTool, {}))) as {
      entries: unknown[];
    };
    const networkResult = JSON.parse(outputOf(await executeTool(networkTool, {}))) as {
      entries: unknown[];
      downloads: Array<{ path: string }>;
    };
    expect(consoleResult.entries).toHaveLength(1);
    expect(networkResult.entries).toHaveLength(1);
    expect(networkResult.downloads[0]?.path).toBe('/tmp/host/report.csv');
  });
});
