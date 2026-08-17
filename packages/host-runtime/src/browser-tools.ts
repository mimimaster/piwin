/**
 * Browser session host tools (ADR 0020 §3, §5).
 *
 * Wraps a `@piwin/browser` `BrowserSession` into Host registrations whose
 * semantics mirror `@playwright/mcp` (accessibility snapshot + element `ref`s).
 * All registrations pass through the Host admission gate. Read-only browser
 * observations are explicit; interactions carry a Host-local tool subject.
 * `browser_navigate` differs from `web_fetch` — loopback is allowed by default (dev-preview convenience) while
 * link-local / private ranges go through the rule engine with default `ask`
 * (never blanket-allow private, to avoid an SSRF hole via cloud metadata).
 */
import { resolve as resolvePath } from 'node:path';
import type {
  HostToolDescriptor,
  HostToolExecutor,
  HostToolPermissionSpec,
  HostToolRegistration,
  PermissionMode,
  PermissionRuleSet,
  ToolResult,
} from '@piwin/contracts';
import type { BrowserSession } from '@piwin/browser';
import { isPrivateOrLocalHostname, mappedIpv4FromIpv6 } from '@piwin/tools-web';
import { findMatchingRule } from './permission-rule-engine.js';
import { applyModeToMatchedRule, type PermissionEvaluation } from './permission-policy.js';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';

// ---------------------------------------------------------------------------
// Permission classification (ADR 0020 §5)
// ---------------------------------------------------------------------------

/**
 * Loopback hosts allowed by default for `browser_navigate` (dev-preview).
 * Everything else that `isPrivateOrLocalHostname` flags is "private → ask".
 */
function isLoopbackHost(host: string): boolean {
  const value = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!value) return true;
  if (value === 'localhost' || value.endsWith('.localhost')) return true;
  // IPv4 loopback 127.0.0.0/8
  if (/^127\.\d{1,3}(\.\d{1,3}){2}$/.test(value)) return true;
  // IPv6 loopback
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  // IPv4-mapped IPv6 loopback (dotted or hex, e.g. ::ffff:127.0.0.1 / ::ffff:7f00:1)
  const mappedV4 = mappedIpv4FromIpv6(value);
  if (mappedV4) {
    return /^127\./.test(mappedV4);
  }
  return false;
}

/**
 * Classify a `browser_navigate` URL for permission gating (ADR 0020 §5).
 *
 * Unlike `evaluateWebPermission` (which hard-denies private/local), navigate
 * allows **loopback** by default and sends everything else — including
 * link-local / cloud metadata and private ranges — through the rule engine
 * with default `ask`. Public hosts also default to `ask`. Only http/https
 * schemes are accepted.
 *
 * Pure function — no IO.
 */
export function evaluateBrowserNavigatePermission(
  url: string,
  rules?: PermissionRuleSet,
  mode: PermissionMode = 'auto',
): PermissionEvaluation {
  const normalized = url.trim();
  if (!normalized) {
    return { decision: 'deny', reason: 'empty-url' };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { decision: 'deny', reason: 'invalid-url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { decision: 'deny', reason: 'blocked-scheme' };
  }

  const host = parsed.hostname.toLowerCase();

  // Consult the rule engine first (deny → ask → allow) using the web-fetch
  // subject kind so existing host-allow rules for dev servers carry over.
  if (rules) {
    const matched = findMatchingRule({ kind: 'web-fetch', host }, rules);
    if (matched) {
      return applyModeToMatchedRule(matched, mode);
    }
  }

  // Loopback is allowed by default (dev-preview convenience).
  if (isLoopbackHost(host)) {
    return { decision: 'allow', reason: 'loopback-allowed' };
  }

  // Private / link-local / metadata → ask (never blanket-allow).
  if (isPrivateOrLocalHostname(host)) {
    return { decision: 'ask', reason: `private-or-local:${host}` };
  }

  // Public hosts ask by default, unless the current invocation mode bypasses
  // prompts. Explicit rules and private-host safeguards still win above.
  return {
    decision: mode === 'bypass' ? 'allow' : 'ask',
    reason: mode === 'bypass' ? `bypass-navigate:${host}` : `navigate:${host}`,
  };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

function createBrowserRegistration(
  descriptor: HostToolDescriptor,
  permissionSpec: HostToolPermissionSpec,
  execute: HostToolExecutor,
  prepareArgs?: HostToolRegistration['prepareArgs'],
): HostToolRegistration {
  return {
    descriptor,
    family: 'browser',
    permissionSpec,
    execute,
    ...(prepareArgs
      ? { prepareArgs }
      : permissionSpec.readOnly === true
        ? {}
        : { prepareArgs: passThroughPrepareArgs }),
  };
}

function success(output: unknown, details?: Record<string, unknown>): ToolResult {
  return {
    ok: true,
    output: typeof output === 'string' ? output : JSON.stringify(output),
    ...(details ? { details } : {}),
  };
}

function permissionSpec(action: string, projectRoot = process.cwd()): HostToolPermissionSpec {
  const readOnlyActions = new Set(['browser:snapshot', 'browser:find', 'browser:wait']);
  if (readOnlyActions.has(action)) {
    return { action, risk: 'unknown', rememberable: false, readOnly: true };
  }
  if (action === 'browser:screenshot') {
    return {
      action,
      risk: 'file-write',
      rememberable: false,
      subjectBuilder: (args) => {
        const path = normalizeScreenshotPath(args.path, projectRoot);
        return path ? { kind: 'file-write', path } : { kind: 'tool', action: 'browser:screenshot' };
      },
    };
  }
  return {
    action,
    risk: 'unknown',
    rememberable: false,
    subjectBuilder: () => ({ kind: 'tool', action }),
  };
}

function normalizeScreenshotPath(value: unknown, projectRoot: string): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  return resolvePath(projectRoot, value.trim());
}

/**
 * Build `browser_*` host tools bound to a `BrowserSession`. Tools are appended
 * to the coding/agent tool set (not knowledge/chat).
 */
export type BrowserToolDefinitionOptions = {
  /** Root used to resolve relative screenshot output paths. */
  projectRoot?: string;
};

export function createBrowserToolDefinitions(
  session: BrowserSession,
  options: BrowserToolDefinitionOptions = {},
): HostToolRegistration[] {
  const projectRoot = options.projectRoot ?? process.cwd();
  const navigate = createBrowserRegistration(
    {
      name: 'browser_navigate',
      description:
        'Navigate the browser to a URL. Use after browser_snapshot to inspect the page. Only http(s) URLs are allowed.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'http(s) URL to navigate to' },
        },
        required: ['url'],
      },
    },
    {
      action: 'browser:navigate',
      risk: 'network',
      rememberable: true,
      subjectBuilder: (args) => {
        try {
          return { kind: 'web-fetch', host: new URL(String(args.url ?? '')).hostname };
        } catch {
          return undefined;
        }
      },
    },
    async (args, signal) => {
      const url = String(args.url ?? '');
      await session.navigate(url, { signal });
      return success({ ok: true, url }, { url });
    },
    (rawArguments, _context, signal) => {
      if (signal.aborted) {
        return {
          ok: false,
          result: { ok: false, code: 'aborted', message: 'tool preparation aborted' },
        };
      }
      if (typeof rawArguments.url !== 'string' || rawArguments.url.trim().length === 0) {
        return {
          ok: false,
          result: { ok: false, code: 'invalid-input', message: 'url is required' },
        };
      }
      const url = rawArguments.url.trim();
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return {
            ok: false,
            result: { ok: false, code: 'invalid-input', message: 'url must be http(s)' },
          };
        }
      } catch {
        return {
          ok: false,
          result: { ok: false, code: 'invalid-input', message: 'url is invalid' },
        };
      }
      return { ok: true, arguments: { ...rawArguments, url } };
    },
  );

  const snapshot = createBrowserRegistration(
    {
      name: 'browser_snapshot',
      description:
        'Capture an accessibility snapshot of the current page. Returns a JSON tree of elements with ref identifiers (e.g. e5) for use with browser_click/browser_type.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    permissionSpec('browser:snapshot'),
    async (_args, signal) => {
      const tree = await session.snapshot({ signal });
      return success(tree);
    },
  );

  const click = createBrowserRegistration(
    {
      name: 'browser_click',
      description:
        'Click an element on the page. Use a ref (from browser_snapshot, e.g. "e5") or a CSS selector.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from browser_snapshot (e.g. e5)' },
          selector: { type: 'string', description: 'CSS selector (used when ref is omitted)' },
        },
      },
    },
    permissionSpec('browser:click'),
    async (args, signal) => {
      const target = resolveTarget(args);
      await session.click(target, { signal });
      return success({ ok: true, target }, { target });
    },
  );

  const type = createBrowserRegistration(
    {
      name: 'browser_type',
      description:
        'Type text into a focusable element. First focuses the element (ref or CSS selector), then types the text character by character.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from browser_snapshot (e.g. e5)' },
          selector: { type: 'string', description: 'CSS selector (used when ref is omitted)' },
          text: { type: 'string', description: 'Text to type into the element' },
        },
        required: ['text'],
      },
    },
    permissionSpec('browser:type'),
    async (args, signal) => {
      const target = resolveTarget(args);
      const text = String(args.text ?? '');
      await session.type(target, text, { signal });
      return success({ ok: true, target, length: text.length }, { target, length: text.length });
    },
  );

  const fillForm = createBrowserRegistration(
    {
      name: 'browser_fill_form',
      description:
        'Fill multiple form fields at once. Each field maps a ref or CSS selector to a value. Uses Playwright fill (sets value directly, no keystroke events).',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'array',
            description: 'List of { ref | selector, value } field descriptors',
            items: {
              type: 'object',
              properties: {
                ref: { type: 'string' },
                selector: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['value'],
            },
          },
        },
        required: ['fields'],
      },
    },
    permissionSpec('browser:fill-form'),
    async (args, signal) => {
      const rawFields = (args.fields ?? []) as Array<Record<string, unknown>>;
      const fields: Record<string, string> = {};
      for (const field of rawFields) {
        const target = resolveTarget(field);
        fields[target] = String(field.value ?? '');
      }
      await session.fillForm(fields, { signal });
      return success(
        { ok: true, count: Object.keys(fields).length },
        { count: Object.keys(fields).length },
      );
    },
  );

  const scroll = createBrowserRegistration(
    {
      name: 'browser_scroll',
      description: 'Scroll the page by a delta. Positive y scrolls down; positive x scrolls right.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: 'Scroll direction (convenience for common deltas)',
          },
        },
      },
    },
    permissionSpec('browser:scroll'),
    async (args, signal) => {
      const direction = String(args.direction ?? 'down');
      const deltaMap: Record<string, { x?: number; y?: number }> = {
        up: { y: -400 },
        down: { y: 400 },
        left: { x: -400 },
        right: { x: 400 },
      };
      const delta = deltaMap[direction] ?? { y: 400 };
      await session.scroll(delta, { signal });
      return success({ ok: true, direction }, { direction });
    },
  );

  const screenshot = createBrowserRegistration(
    {
      name: 'browser_screenshot',
      description:
        'Capture a screenshot of the current page. Returns a JPEG data URL and dimensions. Optionally save to a path.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Optional absolute path to save the screenshot JPEG',
          },
        },
      },
    },
    permissionSpec('browser:screenshot', projectRoot),
    async (args, signal) => {
      const path = normalizeScreenshotPath(args.path, projectRoot);
      const result = await session.screenshot(path, { signal });
      return success(
        {
          width: result.width,
          height: result.height,
          ...(result.path !== undefined ? { path: result.path } : {}),
        },
        {
          width: result.width,
          height: result.height,
          ...(result.path ? { path: result.path } : {}),
        },
      );
    },
  );

  const find = createBrowserRegistration(
    {
      name: 'browser_find',
      description: 'Search for text on the current page. Returns the number of matching elements.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to search for (case-insensitive, partial match)',
          },
        },
        required: ['text'],
      },
    },
    permissionSpec('browser:find'),
    async (args, signal) => {
      const text = String(args.text ?? '');
      if (!text.trim()) return { ok: false, code: 'invalid-input', message: 'text is required' };
      const result = await session.find(text, { signal });
      return success(result);
    },
  );

  const back = createBrowserRegistration(
    {
      name: 'browser_back',
      description: 'Navigate back in browser history.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    permissionSpec('browser:back'),
    async (_args, signal) => {
      await session.back({ signal });
      return success({ ok: true });
    },
  );

  const forward = createBrowserRegistration(
    {
      name: 'browser_forward',
      description: 'Navigate forward in browser history.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    permissionSpec('browser:forward'),
    async (_args, signal) => {
      await session.forward({ signal });
      return success({ ok: true });
    },
  );

  const wait = createBrowserRegistration(
    {
      name: 'browser_wait',
      description:
        'Wait for a fixed duration (milliseconds) before continuing. Use for page transitions or animations.',
      parameters: {
        type: 'object',
        properties: {
          ms: { type: 'number', description: 'Duration to wait in milliseconds' },
        },
        required: ['ms'],
      },
    },
    permissionSpec('browser:wait'),
    async (args, signal) => {
      const ms = Number(args.ms ?? 0);
      if (!Number.isFinite(ms) || ms < 0) {
        return { ok: false, code: 'invalid-input', message: 'ms must be a non-negative number' };
      }
      await session.wait(ms, { signal });
      return success({ ok: true, ms }, { ms });
    },
  );

  return [navigate, snapshot, click, type, fillForm, scroll, screenshot, find, back, forward, wait];
}

/** Resolve a ref-or-selector target from tool args. Refs take precedence. */
function resolveTarget(args: Record<string, unknown>): string {
  if (typeof args.ref === 'string' && args.ref !== '') return args.ref;
  if (typeof args.selector === 'string' && args.selector !== '') return args.selector;
  throw new Error('browser tool requires a ref or selector argument');
}
