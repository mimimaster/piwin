/**
 * Browser session host tools (ADR 0020 §3, §5).
 *
 * Wraps a `@piwin/browser` `BrowserSession` into `HostToolDefinition[]` whose
 * semantics mirror `@playwright/mcp` (accessibility snapshot + element `ref`s).
 * Only `browser_navigate` is permission-gated; the gate differs from
 * `web_fetch` — loopback is allowed by default (dev-preview convenience) while
 * link-local / private ranges go through the rule engine with default `ask`
 * (never blanket-allow private, to avoid an SSRF hole via cloud metadata).
 */
import type { PermissionDecision, PermissionRuleSet } from '@piwin/contracts';
import type { BrowserSession } from '@piwin/browser';
import { isPrivateOrLocalHostname } from '@piwin/tools-web';
import type { HostToolDefinition } from '@piwin/tools-web';
import { findMatchingRule } from './permission-rule-engine.js';
import { resolveNonInteractiveDecision, type PermissionEvaluation } from './permission-policy.js';

/** Reused by the web tools — same interactive gate shape. */
export type BrowserToolPermissionGate = (input: {
  action: string;
  detail: string;
  defaultDecision: PermissionDecision;
  signal?: AbortSignal;
}) => Promise<PermissionDecision>;

export type CreateBrowserToolsOptions = {
  /** Interactive permission gate (Desktop via HostRuntime). When omitted, ask→deny. */
  requestPermission?: BrowserToolPermissionGate;
  /** Merged permission rules; consulted for non-loopback hosts before defaults. */
  rules?: PermissionRuleSet;
};

// ---------------------------------------------------------------------------
// Permission classification (ADR 0020 §5)
// ---------------------------------------------------------------------------

/**
 * Loopback hosts allowed by default for `browser_navigate` (dev-preview).
 * Everything else that `isPrivateOrLocalHostname` flags is "private → ask".
 */
function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) return true;
  if (value === 'localhost' || value.endsWith('.localhost')) return true;
  // IPv4 loopback 127.0.0.0/8
  if (/^127\.\d{1,3}(\.\d{1,3}){2}$/.test(value)) return true;
  // IPv6 loopback
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  // IPv4-mapped IPv6 loopback
  const mappedV4 = value.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mappedV4?.[1]) {
    return /^127\./.test(mappedV4[1]);
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
      return { decision: matched.decision, reason: matched.reason };
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

  // Public hosts → ask by default.
  return { decision: 'ask', reason: `navigate:${host}` };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Build `browser_*` host tools bound to a `BrowserSession`. Tools are appended
 * to the coding/agent tool set (not knowledge/chat). Only `browser_navigate`
 * is permission-gated; all other tools delegate directly to the session.
 */
export function createBrowserToolDefinitions(
  session: BrowserSession,
  options: CreateBrowserToolsOptions = {},
): HostToolDefinition[] {
  const { requestPermission, rules } = options;

  const navigate: HostToolDefinition = {
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
    async execute(args, signal) {
      const url = String(args.url ?? '');
      const evaluation = evaluateBrowserNavigatePermission(url, rules);
      let decision: PermissionDecision = evaluation.decision;

      if (decision === 'ask') {
        if (requestPermission) {
          decision = await requestPermission({
            action: 'browser:navigate',
            detail: url,
            defaultDecision: 'ask',
            ...(signal ? { signal } : {}),
          });
        } else {
          decision = resolveNonInteractiveDecision(evaluation);
        }
      }

      if (decision !== 'allow') {
        throw new Error(
          `Permission ${decision} for browser_navigate: ${evaluation.reason} (${url.slice(0, 120)})`,
        );
      }

      await session.navigate(url, ...(signal ? [{ signal }] : []));
      return JSON.stringify({ ok: true, url });
    },
  };

  const snapshot: HostToolDefinition = {
    name: 'browser_snapshot',
    description:
      'Capture an accessibility snapshot of the current page. Returns a JSON tree of elements with ref identifiers (e.g. e5) for use with browser_click/browser_type.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute(_args, signal) {
      const tree = await session.snapshot(...(signal ? [{ signal }] : []));
      return JSON.stringify(tree, null, 2);
    },
  };

  const click: HostToolDefinition = {
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
    async execute(args, signal) {
      const target = resolveTarget(args);
      await session.click(target, ...(signal ? [{ signal }] : []));
      return JSON.stringify({ ok: true, target });
    },
  };

  const type: HostToolDefinition = {
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
    async execute(args, signal) {
      const target = resolveTarget(args);
      const text = String(args.text ?? '');
      await session.type(target, text, ...(signal ? [{ signal }] : []));
      return JSON.stringify({ ok: true, target, length: text.length });
    },
  };

  const fillForm: HostToolDefinition = {
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
    async execute(args, signal) {
      const rawFields = (args.fields ?? []) as Array<Record<string, unknown>>;
      const fields: Record<string, string> = {};
      for (const field of rawFields) {
        const target = resolveTarget(field);
        fields[target] = String(field.value ?? '');
      }
      await session.fillForm(fields, ...(signal ? [{ signal }] : []));
      return JSON.stringify({ ok: true, count: Object.keys(fields).length });
    },
  };

  const scroll: HostToolDefinition = {
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
    async execute(args, signal) {
      const direction = String(args.direction ?? 'down');
      const deltaMap: Record<string, { x?: number; y?: number }> = {
        up: { y: -400 },
        down: { y: 400 },
        left: { x: -400 },
        right: { x: 400 },
      };
      const delta = deltaMap[direction] ?? { y: 400 };
      await session.scroll(delta, ...(signal ? [{ signal }] : []));
      return JSON.stringify({ ok: true, direction });
    },
  };

  const screenshot: HostToolDefinition = {
    name: 'browser_screenshot',
    description:
      'Capture a screenshot of the current page. Returns a JPEG data URL and dimensions. Optionally save to a path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional absolute path to save the screenshot JPEG' },
      },
    },
    async execute(args, signal) {
      const path = typeof args.path === 'string' ? args.path : undefined;
      const result = await session.screenshot(path, ...(signal ? [{ signal }] : []));
      return JSON.stringify({
        width: result.width,
        height: result.height,
        ...(result.path !== undefined ? { path: result.path } : {}),
      });
    },
  };

  const find: HostToolDefinition = {
    name: 'browser_find',
    description: 'Search for text on the current page. Returns the number of matching elements.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to search for (case-insensitive, partial match)' },
      },
      required: ['text'],
    },
    async execute(args, signal) {
      const text = String(args.text ?? '');
      const result = await session.find(text, ...(signal ? [{ signal }] : []));
      return JSON.stringify(result);
    },
  };

  const back: HostToolDefinition = {
    name: 'browser_back',
    description: 'Navigate back in browser history.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute(_args, signal) {
      await session.back(...(signal ? [{ signal }] : []));
      return JSON.stringify({ ok: true });
    },
  };

  const forward: HostToolDefinition = {
    name: 'browser_forward',
    description: 'Navigate forward in browser history.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute(_args, signal) {
      await session.forward(...(signal ? [{ signal }] : []));
      return JSON.stringify({ ok: true });
    },
  };

  const wait: HostToolDefinition = {
    name: 'browser_wait',
    description: 'Wait for a fixed duration (milliseconds) before continuing. Use for page transitions or animations.',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Duration to wait in milliseconds' },
      },
      required: ['ms'],
    },
    async execute(args, signal) {
      const ms = Number(args.ms ?? 0);
      await session.wait(ms, ...(signal ? [{ signal }] : []));
      return JSON.stringify({ ok: true, ms });
    },
  };

  return [navigate, snapshot, click, type, fillForm, scroll, screenshot, find, back, forward, wait];
}

/** Resolve a ref-or-selector target from tool args. Refs take precedence. */
function resolveTarget(args: Record<string, unknown>): string {
  if (typeof args.ref === 'string' && args.ref !== '') return args.ref;
  if (typeof args.selector === 'string' && args.selector !== '') return args.selector;
  throw new Error('browser tool requires a ref or selector argument');
}
