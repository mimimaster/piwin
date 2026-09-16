import { describe, expect, it, vi } from 'vitest';
import type {
  BrowserSnapshotNode,
  HostToolRegistration,
  ToolResult,
  WebElementPickResult,
} from '@piwin/contracts';
import { isHostToolPermissionAction } from '@piwin/contracts';
import type { BrowserSession } from '@piwin/browser';
import {
  BrowserRuntimeGoneError,
  BrowserStaleTargetError,
  BrowserUserHasControlError,
} from '@piwin/browser';
import { createBrowserToolDefinitions } from './browser-tools.js';
import { createBundledRuleSet } from './permission-defaults.js';
import { createHostToolAdmission } from './tools/tool-admission.js';
import { HostToolExecutionRouter } from './tools/host-tool-execution-router.js';
import { toolFamilyIndex } from './tools/tool-family-index.js';

/** Minimal mock session that records calls and can be controlled in tests. */
function createMockSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  const calls: { method: string; args: unknown[] }[] = [];
  const queue = createExclusiveQueue();
  const base: BrowserSession = {
    start: async () => ({ url: 'http://localhost:3000', title: 'Test' }),
    stop: async () => {},
    navigate: async (url, options) => {
      calls.push({ method: 'navigate', args: [url, options] });
    },
    snapshot: async (options) => {
      calls.push({ method: 'snapshot', args: [options] });
      const tree: BrowserSnapshotNode[] = [
        { role: 'button', name: 'Submit', ref: 'e1', children: [] },
      ];
      return tree;
    },
    click: async (target, options) => {
      calls.push({ method: 'click', args: [target, options] });
    },
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
    listTabs: async (options) => {
      calls.push({ method: 'listTabs', args: [options] });
      return [{ pageId: 'p-1-1', url: 'http://localhost:3000', title: 'Test', kind: 'page' as const, active: true }];
    },
    newTab: async (url, options) => {
      calls.push({ method: 'newTab', args: [url, options] });
      return {
        pageId: 'p-1-2',
        url: url ?? 'about:blank',
        title: '',
        kind: 'page' as const,
        active: true,
      };
    },
    selectTab: async (pageId, options) => {
      calls.push({ method: 'selectTab', args: [pageId, options] });
      return { pageId, url: 'http://localhost:3000', title: 'Test', kind: 'page' as const, active: true };
    },
    closeTab: async (pageId, options) => {
      calls.push({ method: 'closeTab', args: [pageId, options] });
    },
    handleDialog: async (action, promptText, options) => {
      calls.push({ method: 'handleDialog', args: [action, promptText, options] });
      return { pageId: 'p-1-1', type: 'alert', message: 'hi', timedOut: false };
    },
    pendingDialog: () => undefined,
    queryConsole: (limit) => {
      calls.push({ method: 'queryConsole', args: [limit] });
      return [{ level: 'log' as const, text: 'hello', url: 'http://localhost:3000', ts: 1 }];
    },
    queryNetwork: (limit) => {
      calls.push({ method: 'queryNetwork', args: [limit] });
      return [
        {
          method: 'GET',
          url: 'http://localhost:3000/x',
          status: 200,
          resourceType: 'xhr',
          duration: 1,
          failed: false,
          ts: 1,
        },
      ];
    },
    queryDownloads: (limit) => {
      calls.push({ method: 'queryDownloads', args: [limit] });
      return [{ filename: 'a.txt', path: '/tmp/a.txt', url: 'http://localhost/a.txt', ts: 1 }];
    },
    ownership: () => 'owned' as const,
    type: async (target, text, options) => {
      calls.push({ method: 'type', args: [target, text, options] });
    },
    fillForm: async (fields, options) => {
      calls.push({ method: 'fillForm', args: [fields, options] });
    },
    scroll: async (delta, options) => {
      calls.push({ method: 'scroll', args: [delta, options] });
    },
    screenshot: async (path, options) => {
      calls.push({ method: 'screenshot', args: [path, options] });
      return {
        dataUrl: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`,
        width: 1280,
        height: 800,
        ...(path !== undefined ? { path } : {}),
      };
    },
    back: async (options) => {
      calls.push({ method: 'back', args: [options] });
    },
    forward: async (options) => {
      calls.push({ method: 'forward', args: [options] });
    },
    find: async (text, options) => {
      calls.push({ method: 'find', args: [text, options] });
      return { count: 1, candidates: [{ text: 'One match', ref: 'e7' }], truncated: false };
    },
    wait: async (ms, options) => {
      calls.push({ method: 'wait', args: [ms, options] });
    },
    waitFor: async (condition, options) => {
      calls.push({ method: 'waitFor', args: [condition, options] });
    },
    reload: async (options) => {
      calls.push({ method: 'reload', args: [options] });
    },
    pressKey: async (key, options) => {
      calls.push({ method: 'pressKey', args: [key, options] });
    },
    currentTarget: () => ({ generation: 1, pageId: 'page-1', documentRevision: 0 }),
    capture: async () => ({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      mime: 'image/jpeg',
      width: 1280,
      height: 800,
      encodedWidth: 1280,
      encodedHeight: 800,
    }),
    queryViewport: () => {
      calls.push({ method: 'queryViewport', args: [] });
      return { width: 1280, height: 800 };
    },
    applyViewport: async (size, options) => {
      calls.push({ method: 'applyViewport', args: [size, options] });
      return size;
    },
    status: () => {
      calls.push({ method: 'status', args: [] });
      return {
        lifecycle: 'ready' as const,
        mirror: 'streaming' as const,
        generation: 1,
        pageId: 'p-1-1',
        pageStateLost: false,
        recoveryCount: 0,
        url: 'http://localhost:3000',
        title: 'Test',
      };
    },
    restart: async (options) => {
      calls.push({ method: 'restart', args: [options] });
      return { pageStateLost: true, generation: 2, pageId: 'p-2-1' };
    },
    pickElementAt: async (x, y, options) => {
      calls.push({ method: 'pickElementAt', args: [x, y, options] });
      const result: WebElementPickResult = {
        url: 'http://localhost:3000',
        selector: 'button.submit',
        text: 'Submit',
        boundingRect: { x: 10, y: 20, width: 100, height: 40 },
      };
      return result;
    },
    dispatchInput: async (events) => {
      calls.push({ method: 'dispatchInput', args: [events] });
    },
    setViewport: async (size) => {
      calls.push({ method: 'setViewport', args: [size] });
      return size;
    },
    mirrorLeaseCount: () => 1,
    hasMirrorLease: () => true,
    takeOver: async () => ({ owner: 'user' as const, agentWantsLock: true }),
    giveBack: async () => ({ owner: 'agent' as const, agentWantsLock: true }),
    lock: async (owner) => ({
      owner,
      agentWantsLock: owner === 'agent',
    }),
    unlock: async () => ({ owner: 'idle' as const, agentWantsLock: false }),
    releaseAgentControl: async () => {},
    releaseAgentControlIfHeldBy: async () => {},
    controllerState: () => ({ owner: 'idle' as const, agentWantsLock: false }),
    runExclusive: queue.runExclusive,
    subscribe: () => () => {},
    currentState: () => ({ url: 'http://localhost:3000', title: 'Test' }),
    close: async () => {
      calls.push({ method: 'close', args: [] });
    },
    ...overrides,
  };
  return base;
}

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

async function executeThroughAdmission(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
  requestPermission?: (input: {
    action: string;
    detail: string;
    defaultDecision: 'allow' | 'ask' | 'deny';
    signal?: AbortSignal;
  }) => Promise<'allow' | 'ask' | 'deny'>,
): Promise<ToolResult> {
  const admission = createHostToolAdmission({
    rules: createBundledRuleSet(),
    getPermissionMode: () => 'auto',
    ...(requestPermission ? { requestPermission } : {}),
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

function outputOf(result: ToolResult): string {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.output;
}

describe('createBrowserToolDefinitions — schema golden', () => {
  const session = createMockSession();
  const tools = createBrowserToolDefinitions(session);

  it('registers all 25 browser tools without a control lock tool', () => {
    expect(tools.map((t) => t.descriptor.name).sort()).toEqual([
      'browser_back',
      'browser_click',
      'browser_console',
      'browser_dialog',
      'browser_fill_form',
      'browser_find',
      'browser_forward',
      'browser_hover',
      'browser_navigate',
      'browser_network',
      'browser_press_key',
      'browser_reload',
      'browser_restart',
      'browser_screenshot',
      'browser_scroll',
      'browser_select_option',
      'browser_set_checked',
      'browser_snapshot',
      'browser_status',
      'browser_tabs',
      'browser_type',
      'browser_upload',
      'browser_viewport',
      'browser_wait',
      'browser_wait_for',
    ]);
  });

  it('browser_navigate has url param required', () => {
    const nav = tools.find((t) => t.descriptor.name === 'browser_navigate');
    if (!nav) throw new Error('browser_navigate missing');
    expect(nav.descriptor.parameters).toMatchObject({
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    });
  });

  it('browser_click has ref and selector params', () => {
    const click = tools.find((t) => t.descriptor.name === 'browser_click');
    if (!click) throw new Error('browser_click missing');
    expect(click.descriptor.parameters).toMatchObject({
      type: 'object',
      properties: {
        ref: { type: 'string' },
        selector: { type: 'string' },
      },
    });
  });

  it('browser_type has text required', () => {
    const type = tools.find((t) => t.descriptor.name === 'browser_type');
    if (!type) throw new Error('browser_type missing');
    expect(type.descriptor.parameters).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    });
  });

  it('browser_snapshot has no required params', () => {
    const snap = tools.find((t) => t.descriptor.name === 'browser_snapshot');
    if (!snap) throw new Error('browser_snapshot missing');
    expect(snap.descriptor.parameters).toMatchObject({ type: 'object', required: [] });
  });

  it('compose indexes every browser permission action', () => {
    expect(() => toolFamilyIndex(tools)).not.toThrow();
    expect(tools.every((tool) => isHostToolPermissionAction(tool.permissionSpec.action))).toBe(
      true,
    );
  });
});

describe('createBrowserToolDefinitions — execute paths', () => {
  it('browser_snapshot returns JSON tree', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const snap = tools.find((t) => t.descriptor.name === 'browser_snapshot');
    if (!snap) throw new Error('browser_snapshot missing');
    const raw = outputOf(await executeTool(snap, {}));
    const tree = JSON.parse(raw) as BrowserSnapshotNode[];
    expect(tree).toHaveLength(1);
    expect(tree[0]?.role).toBe('button');
    expect(tree[0]?.ref).toBe('e1');
  });

  it('browser_click delegates to session.click with ref', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const click = tools.find((t) => t.descriptor.name === 'browser_click');
    if (!click) throw new Error('browser_click missing');
    const raw = outputOf(await executeTool(click, { ref: 'e5' }));
    const result = JSON.parse(raw) as { ok: boolean; target: string };
    expect(result.ok).toBe(true);
    expect(result.target).toBe('e5');
  });

  it('browser_click delegates to session.click with selector', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const click = tools.find((t) => t.descriptor.name === 'browser_click');
    if (!click) throw new Error('browser_click missing');
    const raw = outputOf(await executeTool(click, { selector: 'button.submit' }));
    expect((JSON.parse(raw) as { target: string }).target).toBe('button.submit');
  });

  it('browser_click returns browser-user-has-control when the human owns the page', async () => {
    const session = createMockSession({
      click: async () => {
        throw new BrowserUserHasControlError('The user has the browser.');
      },
    });
    const tools = createBrowserToolDefinitions(session);
    const click = tools.find((t) => t.descriptor.name === 'browser_click');
    if (!click) throw new Error('browser_click missing');
    const result = await executeTool(click, { ref: 'e5' });
    expect(result).toMatchObject({
      ok: false,
      code: 'browser-user-has-control',
      retryable: false,
    });
  });

  it('browser_click returns browser-runtime-gone when Chromium is gone', async () => {
    const session = createMockSession({
      click: async () => {
        throw new BrowserRuntimeGoneError('browser context is gone');
      },
    });
    const tools = createBrowserToolDefinitions(session);
    const click = tools.find((t) => t.descriptor.name === 'browser_click');
    if (!click) throw new Error('browser_click missing');
    const result = await executeTool(click, { ref: 'e5' });
    expect(result).toMatchObject({
      ok: false,
      code: 'browser-runtime-gone',
      retryable: true,
    });
  });

  it('browser_click throws when neither ref nor selector given', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const click = tools.find((t) => t.descriptor.name === 'browser_click');
    if (!click) throw new Error('browser_click missing');
    await expect(executeTool(click, {})).rejects.toThrow();
  });

  it('browser_type delegates to session.type', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const type = tools.find((t) => t.descriptor.name === 'browser_type');
    if (!type) throw new Error('browser_type missing');
    const raw = outputOf(await executeTool(type, { ref: 'e3', text: 'hello' }));
    expect((JSON.parse(raw) as { length: number }).length).toBe(5);
  });

  it('browser_fill_form maps fields to ref/selector targets', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const fill = tools.find((t) => t.descriptor.name === 'browser_fill_form');
    if (!fill) throw new Error('browser_fill_form missing');
    const raw = outputOf(
      await executeTool(fill, {
        fields: [
          { ref: 'e1', value: 'a' },
          { selector: 'input.email', value: 'b@x.com' },
        ],
      }),
    );
    expect((JSON.parse(raw) as { count: number }).count).toBe(2);
  });

  it('browser_scroll maps direction to delta', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const scroll = tools.find((t) => t.descriptor.name === 'browser_scroll');
    if (!scroll) throw new Error('browser_scroll missing');
    const raw = outputOf(await executeTool(scroll, { direction: 'up' }));
    expect((JSON.parse(raw) as { direction: string }).direction).toBe('up');
  });

  it('browser_screenshot returns dimensions', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const ss = tools.find((t) => t.descriptor.name === 'browser_screenshot');
    if (!ss) throw new Error('browser_screenshot missing');
    const raw = outputOf(await executeTool(ss, {}));
    const result = JSON.parse(raw) as { width: number; height: number };
    expect(result.width).toBe(1280);
    expect(result.height).toBe(800);
  });

  it('browser_screenshot inspect attaches media and omits filesystem paths from output', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session, {
      inspectScreenshot: async ({ jpegBytes, width, height }) => {
        expect(jpegBytes.byteLength).toBeGreaterThan(0);
        return {
          output: {
            status: 'success',
            width,
            height,
            mediaId: 'shot-1',
            mimeType: 'image/jpeg',
            inspect: { status: 'skipped', reason: 'vision-delegation-disabled' },
            evidence: { status: 'unavailable', mediaId: 'shot-1', reason: 'vision-delegation-disabled' },
            notice: 'The client UI already rendered this screenshot as an attachment.',
          },
          details: {
            width,
            height,
            attachments: [
              {
                id: 'shot-1',
                kind: 'media',
                path: '/tmp/media/shot-1.jpg',
                mimeType: 'image/jpeg',
                byteSize: jpegBytes.byteLength,
                source: 'generated',
              },
            ],
          },
        };
      },
    });
    const ss = tools.find((t) => t.descriptor.name === 'browser_screenshot');
    if (!ss) throw new Error('browser_screenshot missing');
    const result = await executeTool(ss, {});
    if (!result.ok) throw new Error(result.message);
    const parsed = JSON.parse(result.output) as {
      status: string;
      mediaId: string;
      inspect: { status: string };
    };
    expect(parsed.status).toBe('success');
    expect(parsed.mediaId).toBe('shot-1');
    expect(parsed.inspect.status).toBe('skipped');
    expect(result.output).not.toContain('/tmp/media');
    expect(result.details?.attachments).toEqual([
      expect.objectContaining({ id: 'shot-1', kind: 'media', mimeType: 'image/jpeg' }),
    ]);
  });

  it('browser_screenshot reports unavailable evidence when media persistence fails', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session, {
      inspectScreenshot: async () => {
        throw new Error('media root unavailable');
      },
    });
    const ss = tools.find((t) => t.descriptor.name === 'browser_screenshot');
    if (!ss) throw new Error('browser_screenshot missing');
    const result = await executeTool(ss, {});
    expect(result.ok).toBe(true);
    const payload = JSON.parse(outputOf(result)) as {
      status: string;
      evidence: { status: string; reason: string };
    };
    expect(payload.status).toBe('success');
    expect(payload.evidence.status).toBe('unavailable');
    expect(payload.evidence.reason).toContain('media-persist-failed');
  });

  it('browser_screenshot puts native images on ToolResult for vision models', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session, {
      inspectScreenshot: async ({ jpegBytes, width, height }) => ({
        output: {
          status: 'success',
          width,
          height,
          mediaId: 'shot-2',
          mimeType: 'image/jpeg',
          inspect: { status: 'native' },
          evidence: { status: 'delivered', mediaId: 'shot-2' },
          notice: 'A screenshot image is attached to this tool result.',
        },
        details: {
          width,
          height,
          attachments: [
            {
              id: 'shot-2',
              kind: 'media',
              path: '/tmp/media/shot-2.jpg',
              mimeType: 'image/jpeg',
              byteSize: jpegBytes.byteLength,
              source: 'generated',
            },
          ],
        },
        images: [{ mimeType: 'image/jpeg', dataBase64: Buffer.from(jpegBytes).toString('base64') }],
      }),
    });
    const ss = tools.find((t) => t.descriptor.name === 'browser_screenshot');
    if (!ss) throw new Error('browser_screenshot missing');
    const result = await executeTool(ss, {});
    if (!result.ok) throw new Error(result.message);
    expect(result.images).toEqual([
      expect.objectContaining({ mimeType: 'image/jpeg', dataBase64: expect.any(String) }),
    ]);
    expect(result.output).not.toContain('dataBase64');
  });

  it('browser_screenshot still returns dimensions when inspect throws', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session, {
      inspectScreenshot: async () => {
        throw new Error('disk full');
      },
    });
    const ss = tools.find((t) => t.descriptor.name === 'browser_screenshot');
    if (!ss) throw new Error('browser_screenshot missing');
    const raw = outputOf(await executeTool(ss, {}));
    const result = JSON.parse(raw) as { width: number; height: number };
    expect(result.width).toBe(1280);
    expect(result.height).toBe(800);
  });

  it('browser_find returns count', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const find = tools.find((t) => t.descriptor.name === 'browser_find');
    if (!find) throw new Error('browser_find missing');
    const raw = outputOf(await executeTool(find, { text: 'Submit' }));
    expect((JSON.parse(raw) as { count: number }).count).toBe(1);
  });

  it('browser_find accepts the legacy query alias through the Host router', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const find = tools.find((t) => t.descriptor.name === 'browser_find');
    if (!find) throw new Error('browser_find missing');
    const result = await executeThroughAdmission(find, { query: 'Submit' });
    expect((JSON.parse(outputOf(result)) as { count: number }).count).toBe(1);
  });

  it('browser_wait delegates to session.wait', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const wait = tools.find((t) => t.descriptor.name === 'browser_wait');
    if (!wait) throw new Error('browser_wait missing');
    const raw = outputOf(await executeTool(wait, { ms: 100 }));
    expect((JSON.parse(raw) as { ms: number }).ms).toBe(100);
  });

  it('browser_status reads session.status without start/navigate', async () => {
    const start = vi.fn(async () => ({ url: 'http://localhost:3000', title: 'Test' }));
    const navigate = vi.fn(async () => {});
    const session = createMockSession({ start, navigate });
    const tools = createBrowserToolDefinitions(session);
    const tool = tools.find((t) => t.descriptor.name === 'browser_status');
    if (!tool) throw new Error('browser_status missing');
    const raw = outputOf(await executeTool(tool, {}));
    const result = JSON.parse(raw) as { lifecycle: string; generation: number };
    expect(result.lifecycle).toBe('ready');
    expect(result.generation).toBe(1);
    expect(start).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('browser_restart reports pageStateLost', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const tool = tools.find((t) => t.descriptor.name === 'browser_restart');
    if (!tool) throw new Error('browser_restart missing');
    const result = await executeTool(tool, {});
    if (!result.ok) throw new Error(result.message);
    expect(JSON.parse(result.output)).toMatchObject({ ok: true, pageStateLost: true });
    expect(result.details?.pageStateLost).toBe(true);
  });

  it('browser_restart fails when the user owns the page', async () => {
    const session = createMockSession({
      restart: async () => {
        throw new BrowserUserHasControlError('The user has the browser.');
      },
    });
    const tools = createBrowserToolDefinitions(session);
    const tool = tools.find((t) => t.descriptor.name === 'browser_restart');
    if (!tool) throw new Error('browser_restart missing');
    const result = await executeTool(tool, {});
    expect(result).toMatchObject({ ok: false, code: 'browser-user-has-control' });
  });

  it('browser_press_key delegates a valid key', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const tool = tools.find((t) => t.descriptor.name === 'browser_press_key');
    if (!tool) throw new Error('browser_press_key missing');
    const raw = outputOf(await executeTool(tool, { key: 'Enter' }));
    expect((JSON.parse(raw) as { key: string }).key).toBe('Enter');
  });

  it('browser_wait_for rejects two conditions', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const tool = tools.find((t) => t.descriptor.name === 'browser_wait_for');
    if (!tool) throw new Error('browser_wait_for missing');
    const prepare = tool.prepareArgs;
    if (!prepare) throw new Error('browser_wait_for prepareArgs missing');
    const prepared = await prepare(
      { text: 'Hello', url: 'https://example.com' },
      {
        sessionId: 'session-1',
        runtimeGenerationId: 'generation-1',
        runId: 'run-1',
        toolName: 'browser_wait_for',
      },
      new AbortController().signal,
    );
    expect(prepared).toMatchObject({
      ok: false,
      result: { ok: false, code: 'invalid-input' },
    });
  });

  it('browser_viewport query does not write', async () => {
    const applyViewport = vi.fn(async (size: { width: number; height: number }) => size);
    const session = createMockSession({ applyViewport });
    const tools = createBrowserToolDefinitions(session);
    const tool = tools.find((t) => t.descriptor.name === 'browser_viewport');
    if (!tool) throw new Error('browser_viewport missing');
    const raw = outputOf(await executeTool(tool, { action: 'query' }));
    expect(JSON.parse(raw)).toEqual({ width: 1280, height: 800 });
    expect(applyViewport).not.toHaveBeenCalled();
  });

  it('browser_click maps overlay intercept to browser-action-failed', async () => {
    const session = createMockSession({
      click: async () => {
        throw new Error('<div> intercepts pointer events');
      },
    });
    const tools = createBrowserToolDefinitions(session);
    const click = tools.find((t) => t.descriptor.name === 'browser_click');
    if (!click) throw new Error('browser_click missing');
    const result = await executeTool(click, { ref: 'e5' });
    expect(result).toMatchObject({
      ok: false,
      code: 'browser-action-failed',
      details: { reason: 'overlay' },
    });
  });
});

describe('browser_navigate permission gate', () => {
  it('allows loopback without prompt', async () => {
    const session = createMockSession();
    const requestPermission = vi.fn().mockResolvedValue('allow' as const);
    const tools = createBrowserToolDefinitions(session);
    const nav = tools.find((t) => t.descriptor.name === 'browser_navigate');
    if (!nav) throw new Error('browser_navigate missing');
    const raw = outputOf(
      await executeThroughAdmission(nav, { url: 'http://localhost:3000' }, requestPermission),
    );
    expect(requestPermission).not.toHaveBeenCalled();
    expect((JSON.parse(raw) as { ok: boolean }).ok).toBe(true);
  });

  it('prompts for public host', async () => {
    const session = createMockSession();
    const requestPermission = vi.fn().mockResolvedValue('allow' as const);
    const tools = createBrowserToolDefinitions(session);
    const nav = tools.find((t) => t.descriptor.name === 'browser_navigate');
    if (!nav) throw new Error('browser_navigate missing');
    await executeThroughAdmission(nav, { url: 'https://example.com' }, requestPermission);
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'browser:navigate' }),
    );
  });

  it('denies when permission gate returns deny', async () => {
    const session = createMockSession();
    const requestPermission = vi.fn().mockResolvedValue('deny' as const);
    const tools = createBrowserToolDefinitions(session);
    const nav = tools.find((t) => t.descriptor.name === 'browser_navigate');
    if (!nav) throw new Error('browser_navigate missing');
    const result = await executeThroughAdmission(
      nav,
      { url: 'https://example.com' },
      requestPermission,
    );
    expect(result).toMatchObject({ ok: false, code: 'permission-denied' });
  });

  it('non-interactive (no gate) denies ask for public host', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const nav = tools.find((t) => t.descriptor.name === 'browser_navigate');
    if (!nav) throw new Error('browser_navigate missing');
    const result = await executeThroughAdmission(nav, { url: 'https://example.com' });
    expect(result).toMatchObject({ ok: false, code: 'permission-denied' });
  });

  it('non-interactive (no gate) allows loopback', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const nav = tools.find((t) => t.descriptor.name === 'browser_navigate');
    if (!nav) throw new Error('browser_navigate missing');
    const raw = outputOf(await executeThroughAdmission(nav, { url: 'http://127.0.0.1:4000' }));
    expect((JSON.parse(raw) as { ok: boolean }).ok).toBe(true);
  });
});

describe('browser_reload permission from currentState', () => {
  it('binds permission subject from currentState when the model omits url', async () => {
    const session = createMockSession({
      currentState: () => ({ url: 'https://example.com/page', title: 'Example' }),
      status: () => ({
        lifecycle: 'ready',
        mirror: 'streaming',
        generation: 1,
        pageId: 'p-1-1',
        pageStateLost: false,
        recoveryCount: 0,
        url: 'https://example.com/page',
      }),
    });
    const requestPermission = vi.fn().mockResolvedValue('allow' as const);
    const tools = createBrowserToolDefinitions(session);
    const tool = tools.find((t) => t.descriptor.name === 'browser_reload');
    if (!tool) throw new Error('browser_reload missing');
    await executeThroughAdmission(tool, {}, requestPermission);
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'browser:navigate',
        detail: expect.stringContaining('https://example.com/page'),
      }),
    );
  });

  it('ignores a model-supplied url for authorization', async () => {
    const session = createMockSession({
      currentState: () => ({ url: 'https://example.com/page', title: 'Example' }),
      status: () => ({
        lifecycle: 'ready',
        mirror: 'streaming',
        generation: 1,
        pageId: 'p-1-1',
        pageStateLost: false,
        recoveryCount: 0,
        url: 'https://example.com/page',
      }),
    });
    const requestPermission = vi.fn().mockResolvedValue('allow' as const);
    const tools = createBrowserToolDefinitions(session);
    const tool = tools.find((t) => t.descriptor.name === 'browser_reload');
    if (!tool) throw new Error('browser_reload missing');
    await executeThroughAdmission(tool, { url: 'https://evil.example/' }, requestPermission);
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('https://example.com/page'),
      }),
    );
    expect(requestPermission.mock.calls[0]?.[0]?.detail).not.toContain('evil.example');
  });

  it('returns stale-target when the URL changes after approval', async () => {
    let url = 'https://example.com/page';
    const session = createMockSession({
      currentState: () => ({ url, title: 'Example' }),
      status: () => ({
        lifecycle: 'ready',
        mirror: 'streaming',
        generation: 1,
        pageId: 'p-1-1',
        pageStateLost: false,
        recoveryCount: 0,
        url,
      }),
      reload: async (options) => {
        if (options?.expectedUrl !== undefined && options.expectedUrl !== url) {
          throw new BrowserStaleTargetError('page URL changed after permission', {
            pageStateLost: false,
          });
        }
      },
    });
    const requestPermission = vi.fn().mockImplementation(async () => {
      url = 'https://other.example/';
      return 'allow' as const;
    });
    const tools = createBrowserToolDefinitions(session);
    const tool = tools.find((t) => t.descriptor.name === 'browser_reload');
    if (!tool) throw new Error('browser_reload missing');
    const result = await executeThroughAdmission(tool, {}, requestPermission);
    expect(result).toMatchObject({ ok: false, code: 'browser-stale-target' });
  });

  it('returns invalid-input when there is no current page URL', async () => {
    const session = createMockSession({
      currentState: () => ({}),
      status: () => ({
        lifecycle: 'stopped',
        mirror: 'off',
        generation: 0,
        pageStateLost: false,
        recoveryCount: 0,
      }),
    });
    const tools = createBrowserToolDefinitions(session);
    const tool = tools.find((t) => t.descriptor.name === 'browser_reload');
    if (!tool) throw new Error('browser_reload missing');
    const result = await executeThroughAdmission(tool, {});
    expect(result).toMatchObject({ ok: false, code: 'invalid-input' });
  });
});

describe('browser tool mutex serialization', () => {
  it('serializes a concurrent tool call + pick through runExclusive', async () => {
    const order: string[] = [];
    let releaseNavigate: () => void = () => {};
    const navigatePromise = new Promise<void>((resolve) => {
      releaseNavigate = resolve;
    });

    const session = createMockSession({
      navigate: (url) =>
        session.runExclusive(async () => {
          order.push('navigate-start');
          await navigatePromise;
          order.push('navigate-end');
        }),
      pickElementAt: (x, y) =>
        session.runExclusive(async () => {
          order.push('pick');
          return {
            url: 'http://localhost:3000',
            selector: 'div',
            text: 'x',
            boundingRect: { x, y, width: 10, height: 10 },
          };
        }),
    });

    const tools = createBrowserToolDefinitions(session);
    const nav = tools.find((t) => t.descriptor.name === 'browser_navigate');
    if (!nav) throw new Error('browser_navigate missing');

    // Start navigate (loopback → allowed, no prompt) — it blocks on the promise.
    const navPromise = executeTool(nav, { url: 'http://localhost:3000' });
    // Give the navigate a chance to enter the mutex.
    await new Promise((r) => setImmediate(r));

    // Pick must wait for navigate to finish (serialized through runExclusive).
    const pickPromise = session.pickElementAt(10, 20);
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(['navigate-start']);

    releaseNavigate();
    await Promise.all([navPromise, pickPromise]);
    expect(order).toEqual(['navigate-start', 'navigate-end', 'pick']);
  });
});
