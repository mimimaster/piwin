import { describe, expect, it, vi } from 'vitest';
import type {
  BrowserSnapshotNode,
  HostToolRegistration,
  ToolResult,
  WebElementPickResult,
} from '@piwin/contracts';
import type { BrowserSession } from '@piwin/browser';
import {
  createBrowserToolDefinitions,
  evaluateBrowserNavigatePermission,
} from './browser-tools.js';
import { createBundledRuleSet } from './permission-defaults.js';
import type { PermissionRuleSet } from '@piwin/contracts';
import { createHostToolPermissionGate } from './tools/host-tool-admission-gate.js';
import { HostToolExecutionRouter } from './tools/host-tool-execution-router.js';

/** Minimal mock session that records calls and can be controlled in tests. */
function createMockSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  const calls: { method: string; args: unknown[] }[] = [];
  const queue = createExclusiveQueue();
  const base: BrowserSession = {
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
        dataUrl: 'data:image/jpeg;base64,AAA=',
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
      return { count: 1 };
    },
    wait: async (ms, options) => {
      calls.push({ method: 'wait', args: [ms, options] });
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
  const permissionGate = createHostToolPermissionGate({
    rules: createBundledRuleSet(),
    getPermissionMode: () => 'auto',
    ...(requestPermission ? { requestPermission } : {}),
    projectRoot: '/tmp',
    mcpEnabledServerIds: [],
  });
  const router = new HostToolExecutionRouter({ tools: [tool], permissionGate });
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

  it('registers all 11 browser tools', () => {
    expect(tools.map((t) => t.descriptor.name).sort()).toEqual([
      'browser_back',
      'browser_click',
      'browser_fill_form',
      'browser_find',
      'browser_forward',
      'browser_navigate',
      'browser_screenshot',
      'browser_scroll',
      'browser_snapshot',
      'browser_type',
      'browser_wait',
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

  it('browser_find returns count', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const find = tools.find((t) => t.descriptor.name === 'browser_find');
    if (!find) throw new Error('browser_find missing');
    const raw = outputOf(await executeTool(find, { text: 'Submit' }));
    expect((JSON.parse(raw) as { count: number }).count).toBe(1);
  });

  it('browser_wait delegates to session.wait', async () => {
    const session = createMockSession();
    const tools = createBrowserToolDefinitions(session);
    const wait = tools.find((t) => t.descriptor.name === 'browser_wait');
    if (!wait) throw new Error('browser_wait missing');
    const raw = outputOf(await executeTool(wait, { ms: 100 }));
    expect((JSON.parse(raw) as { ms: number }).ms).toBe(100);
  });
});

describe('evaluateBrowserNavigatePermission', () => {
  it('denies empty url', () => {
    expect(evaluateBrowserNavigatePermission('')).toEqual({
      decision: 'deny',
      reason: 'empty-url',
    });
  });

  it('denies invalid url', () => {
    expect(evaluateBrowserNavigatePermission('not-a-url')).toEqual({
      decision: 'deny',
      reason: 'invalid-url',
    });
  });

  it('denies non-http schemes', () => {
    expect(evaluateBrowserNavigatePermission('file:///etc/passwd').decision).toBe('deny');
    expect(evaluateBrowserNavigatePermission('javascript:alert(1)').decision).toBe('deny');
  });

  it('allows loopback localhost by default', () => {
    const result = evaluateBrowserNavigatePermission('http://localhost:3000');
    expect(result.decision).toBe('allow');
    expect(result.reason).toBe('loopback-allowed');
  });

  it('allows 127.0.0.1 by default', () => {
    expect(evaluateBrowserNavigatePermission('http://127.0.0.1:8080').decision).toBe('allow');
  });

  it('allows ::1 by default', () => {
    expect(evaluateBrowserNavigatePermission('http://[::1]:8080').decision).toBe('allow');
  });

  it('allows *.localhost by default', () => {
    expect(evaluateBrowserNavigatePermission('http://api.localhost:3000').decision).toBe('allow');
  });

  it('asks for private 10.x range', () => {
    const result = evaluateBrowserNavigatePermission('http://10.0.0.1');
    expect(result.decision).toBe('ask');
    expect(result.reason).toContain('private-or-local');
  });

  it('asks for 192.168.x range', () => {
    expect(evaluateBrowserNavigatePermission('http://192.168.1.1').decision).toBe('ask');
  });

  it('asks for 172.16.x range', () => {
    expect(evaluateBrowserNavigatePermission('http://172.16.0.1').decision).toBe('ask');
  });

  it('asks for link-local 169.254.169.254 (cloud metadata)', () => {
    const result = evaluateBrowserNavigatePermission('http://169.254.169.254/latest/meta-data/');
    expect(result.decision).toBe('ask');
    expect(result.reason).toContain('private-or-local');
  });

  it('asks for fd00::/8 ULA', () => {
    expect(evaluateBrowserNavigatePermission('http://[fd12::1]').decision).toBe('ask');
  });

  it('asks for fe80::/10 link-local', () => {
    expect(evaluateBrowserNavigatePermission('http://[fe80::1]').decision).toBe('ask');
  });

  it('asks for public hosts by default', () => {
    const result = evaluateBrowserNavigatePermission('https://example.com');
    expect(result.decision).toBe('ask');
    expect(result.reason).toBe('navigate:example.com');
  });

  it('consults rule engine before defaults (allow rule)', () => {
    const rules: PermissionRuleSet = {
      deny: [],
      ask: [],
      allow: [
        {
          target: { kind: 'web-fetch', hostGlob: 'example.com' },
          decision: 'allow',
          reason: 'rule-allow',
        },
      ],
    };
    const result = evaluateBrowserNavigatePermission('https://example.com', rules);
    expect(result.decision).toBe('allow');
    expect(result.reason).toBe('rule-allow');
  });

  it('consults rule engine before defaults (deny rule overrides loopback)', () => {
    const rules: PermissionRuleSet = {
      deny: [
        {
          target: { kind: 'web-fetch', hostGlob: 'localhost' },
          decision: 'deny',
          reason: 'rule-deny',
        },
      ],
      ask: [],
      allow: [],
    };
    const result = evaluateBrowserNavigatePermission('http://localhost:3000', rules);
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('rule-deny');
  });

  it('falls through to defaults when no rule matches', () => {
    const rules = createBundledRuleSet();
    const result = evaluateBrowserNavigatePermission('http://localhost:3000', rules);
    expect(result.decision).toBe('allow');
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
