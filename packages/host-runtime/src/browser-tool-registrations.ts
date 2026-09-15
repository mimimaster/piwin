/**
 * Browser session host tool registrations (ADR 0020 §3, §5).
 *
 * Wraps a `@piwin/browser` `BrowserSession` into Host registrations whose
 * semantics mirror `@playwright/mcp` (accessibility snapshot + element `ref`s).
 * All registrations pass through the Host admission gate. Read-only browser
 * observations are explicit; interactions carry a Host-local tool subject.
 * `browser_navigate` differs from `web_fetch` — loopback is allowed by default (dev-preview convenience) while
 * link-local / private ranges go through the rule engine with default `ask`
 * (never blanket-allow private, to avoid an SSRF hole via cloud metadata).
 */
import type {
  BrowserViewportMode,
  HostToolArgumentPreparation,
  HostToolExecutionContext,
  HostToolRegistration,
  ToolResult,
} from '@piwin/contracts';
import type { BrowserOpOptions, BrowserSession, BrowserWaitForCondition } from '@piwin/browser';
import {
  BROWSER_SCROLL_DEFAULT_AMOUNT_PX,
  BROWSER_SCROLL_MAX_AMOUNT_PX,
} from '@piwin/contracts';
import {
  clampBrowserWaitForTimeout,
  isValidBrowserKey,
  resolveBrowserViewport,
} from '@piwin/browser';
import {
  jpegBytesFromDataUrl,
  type PersistBrowserScreenshotResult,
} from './browser-screenshot-inspect.js';
import {
  mapBrowserExecuteError,
  sanitizeBrowserErrorMessage,
  userControlResult,
} from './browser-tool-errors.js';
import { createBrowserStageBcToolDefinitions } from './browser-tool-stage-bc.js';
import { nextBrowserAction, readBrowserPageState } from './browser-tool-page-state.js';

import {
  AGENT_WRITE_HINT,
  USER_CONTROL_HINT,
  abortedPreparation,
  agentWriteOptions,
  createBrowserRegistration,
  normalizeScreenshotPath,
  permissionSpec,
  prepareBrowserFindArgs,
  invalidPreparation,
  prepareBrowserTargetArgs,
  screenshotEvidenceFailure,
  success,
  successWithPage,
} from './browser-tool-helpers.js';


/**
 * Build `browser_*` host tools bound to a `BrowserSession`. Tools are appended
 * to the coding/agent tool set (not knowledge/chat).
 */
export type BrowserToolDefinitionOptions = {
  /** Root used to resolve relative screenshot output paths. */
  projectRoot?: string;
  /**
   * Persist the JPEG under the session media root and optionally describe it.
   * When omitted, the tool returns dimensions only (tests / no media).
   */
  inspectScreenshot?: (input: {
    jpegBytes: Uint8Array;
    width: number;
    height: number;
    signal: AbortSignal;
  }) => Promise<PersistBrowserScreenshotResult>;
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
        'Navigate the right-sidebar browser to an http(s) URL. Use this when the page needs JS, login state or real interaction; prefer web_fetch for reading static documents.' +
        USER_CONTROL_HINT +
        AGENT_WRITE_HINT,
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
    async (args, signal, context) => {
      const url = String(args.url ?? '');
      try {
        await session.navigate(url, agentWriteOptions(signal, context));
      } catch (error) {
        return userControlResult(error);
      }
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
        'Capture an accessibility tree snapshot. Returns low-token structural elements with ref IDs (e.g. "e5") for click/type targeting. Refs are valid only for the current document revision; re-snapshot after navigation or a browser-stale-target result.',
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
        'Click a page element targeting a snapshot ref (e.g. "e5") or CSS selector.' +
        USER_CONTROL_HINT +
        AGENT_WRITE_HINT,
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from browser_snapshot (e.g. e5)' },
          selector: { type: 'string', description: 'CSS selector (used when ref is omitted)' },
        },
      },
    },
    permissionSpec('browser:click'),
    async (args, signal, context) => {
      const target = resolveTarget(args);
      try {
        await session.click(target, agentWriteOptions(signal, context));
      } catch (error) {
        return mapBrowserExecuteError(error, 'click');
      }
      return successWithPage(session, { ok: true, target }, { target });
    },
    prepareBrowserTargetArgs,
  );

  const type = createBrowserRegistration(
    {
      name: 'browser_type',
      description:
        'Focus an element (via ref or CSS selector) and type text character by character. Typing appends to existing content; use browser_fill_form to replace a field value.' +
        USER_CONTROL_HINT +
        AGENT_WRITE_HINT,
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
    async (args, signal, context) => {
      const target = resolveTarget(args);
      const text = String(args.text ?? '');
      try {
        await session.type(target, text, agentWriteOptions(signal, context));
      } catch (error) {
        return userControlResult(error);
      }
      return successWithPage(session, { ok: true, target, length: text.length }, { target, length: text.length });
    },
    prepareBrowserTargetArgs,
  );

  const fillForm = createBrowserRegistration(
    {
      name: 'browser_fill_form',
      description:
        'Batch fill text-like form fields by mapping refs or selectors to values. Use browser_set_checked for checkboxes/radios and browser_select_option for <select>.' +
        USER_CONTROL_HINT,
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
    async (args, signal, context) => {
      const rawFields = (args.fields ?? []) as Array<Record<string, unknown>>;
      const fields: Record<string, string> = {};
      for (const field of rawFields) {
        const target = resolveTarget(field);
        fields[target] = String(field.value ?? '');
      }
      try {
        await session.fillForm(fields, agentWriteOptions(signal, context));
      } catch (error) {
        return userControlResult(error);
      }
      return success(
        { ok: true, count: Object.keys(fields).length },
        { count: Object.keys(fields).length },
      );
    },
  );

  const scroll = createBrowserRegistration(
    {
      name: 'browser_scroll',
      description:
        'Scroll the page or a specific scroll container. Give direction and an optional amount in CSS px (1-2000, default 400). Without ref/selector the page root scrolls.' +
        USER_CONTROL_HINT,
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: 'Scroll direction (default down)',
          },
          amount: {
            type: 'number',
            description: `CSS px to scroll (1-${BROWSER_SCROLL_MAX_AMOUNT_PX}, default ${BROWSER_SCROLL_DEFAULT_AMOUNT_PX})`,
          },
          ref: { type: 'string', description: 'Scroll container ref from browser_snapshot' },
          selector: {
            type: 'string',
            description: 'Scroll container CSS selector (used when ref is omitted)',
          },
        },
      },
    },
    permissionSpec('browser:scroll'),
    async (args, signal, context) => {
      const direction = String(args.direction ?? 'down');
      const amount = resolveScrollAmount(args.amount) ?? BROWSER_SCROLL_DEFAULT_AMOUNT_PX;
      const sign = direction === 'up' || direction === 'left' ? -1 : 1;
      const distance = sign * amount;
      const delta =
        direction === 'left' || direction === 'right' ? { x: distance } : { y: distance };
      const target = optionalTarget(args);
      try {
        await session.scroll(delta, {
          ...agentWriteOptions(signal, context),
          ...(target !== undefined ? { target } : {}),
        });
      } catch (error) {
        return userControlResult(error);
      }
      return success(
        { ok: true, direction, amount, ...(target !== undefined ? { target } : {}) },
        { direction, amount, ...(target !== undefined ? { target } : {}) },
      );
    },
    (rawArguments, _context, signal) => {
      if (signal.aborted) return abortedPreparation();
      if (resolveScrollAmount(rawArguments.amount) === undefined) {
        return invalidPreparation(
          `amount must be a number between 1 and ${BROWSER_SCROLL_MAX_AMOUNT_PX}`,
        );
      }
      const direction = rawArguments.direction;
      if (
        direction !== undefined &&
        direction !== 'up' &&
        direction !== 'down' &&
        direction !== 'left' &&
        direction !== 'right'
      ) {
        return invalidPreparation('direction must be up, down, left, or right');
      }
      return { ok: true, arguments: rawArguments };
    },
  );

  const screenshot = createBrowserRegistration(
    {
      name: 'browser_screenshot',
      description:
        'Capture a visual page screenshot for UI layout verification. Check evidence.status in the result: only "delivered" or "delegated" means the model received pixels; "unavailable" is not visual evidence.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Optional absolute path to save a JPEG copy',
          },
        },
      },
    },
    permissionSpec('browser:screenshot', projectRoot),
    async (args, signal) => {
      const path = normalizeScreenshotPath(args.path, projectRoot);
      const result = await session.screenshot(path, { signal });
      const base = {
        width: result.width,
        height: result.height,
        ...(result.path !== undefined ? { path: result.path } : {}),
      };
      const inspect = options.inspectScreenshot;
      if (!inspect) {
        // No media pipeline configured: capture is real, evidence delivery is not.
        return screenshotEvidenceFailure(base, 'no-media-pipeline');
      }
      const jpegBytes = jpegBytesFromDataUrl(result.dataUrl);
      if (!jpegBytes) {
        return screenshotEvidenceFailure(base, 'capture-encoding-invalid');
      }
      try {
        const inspected = await inspect({
          jpegBytes,
          width: result.width,
          height: result.height,
          signal,
        });
        return success(inspected.output, inspected.details, inspected.images);
      } catch (error) {
        // Capture success and evidence delivery are separate outcomes: never
        // degrade to a bare width/height "success" (spec §7).
        return screenshotEvidenceFailure(
          base,
          `media-persist-failed: ${sanitizeBrowserErrorMessage(error)}`,
        );
      }
    },
  );

  const find = createBrowserRegistration(
    {
      name: 'browser_find',
      description:
        'Search the accessibility tree for matching text. Returns up to 20 candidates { text, ref? } plus the total count; a candidate with a ref can be used directly as a click/type target.',
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
    prepareBrowserFindArgs,
  );

  const back = createBrowserRegistration(
    {
      name: 'browser_back',
      description: 'Navigate backward in browser history.' + USER_CONTROL_HINT,
      parameters: { type: 'object', properties: {}, required: [] },
    },
    permissionSpec('browser:back'),
    async (_args, signal, context) => {
      try {
        await session.back(agentWriteOptions(signal, context));
      } catch (error) {
        return userControlResult(error);
      }
      return success({ ok: true });
    },
  );

  const forward = createBrowserRegistration(
    {
      name: 'browser_forward',
      description: 'Navigate forward in browser history.' + USER_CONTROL_HINT,
      parameters: { type: 'object', properties: {}, required: [] },
    },
    permissionSpec('browser:forward'),
    async (_args, signal, context) => {
      try {
        await session.forward(agentWriteOptions(signal, context));
      } catch (error) {
        return userControlResult(error);
      }
      return success({ ok: true });
    },
  );

  const wait = createBrowserRegistration(
    {
      name: 'browser_wait',
      description:
        'Fixed short delay for animations and transitions. This is not evidence that a page finished loading; use browser_wait_for to confirm a state instead.',
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

  const browserLock = createBrowserRegistration(
    {
      name: 'browser_lock',
      description:
        'Acquire or release agent control over the shared browser workbench. Use action=unlock to release; there is no separate browser_unlock tool.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['lock', 'unlock'], description: 'lock or unlock' },
        },
        required: ['action'],
      },
    },
    permissionSpec('browser:lock'),
    async (args, signal, context) => {
      const action = String(args.action ?? '');
      if (action !== 'lock' && action !== 'unlock') {
        return { ok: false, code: 'invalid-input', message: 'action must be lock or unlock' };
      }
      try {
        if (action === 'lock') {
          const state = await session.lock('agent', agentWriteOptions(signal, context));
          return success({ ok: true, action, ...state }, { action, owner: state.owner });
        }
        const state = await session.unlock('agent');
        return success({ ok: true, action, ...state }, { action, owner: state.owner });
      } catch (error) {
        return userControlResult(error);
      }
    },
  );

  const status = createBrowserRegistration(
    {
      name: 'browser_status',
      description:
        'Read-only workbench entry point; launches nothing. Returns current URL, page identity, control ownership, mirror/lifecycle, pending dialog and a nextAction hint.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    permissionSpec('browser:status'),
    async () => {
      const status = session.status();
      const controller = session.controllerState();
      const pendingDialog = session.pendingDialog() ?? null;
      return success({
        ...status,
        controller: controller.owner,
        agentWantsLock: controller.agentWantsLock,
        pendingDialog,
        nextAction: nextBrowserAction({
          lifecycle: status.lifecycle,
          controller: controller.owner,
        }),
      });
    },
  );

  const restart = createBrowserRegistration(
    {
      name: 'browser_restart',
      description:
        'Restart the Host-owned Chromium workbench. The previous page is lost (pageStateLost).' +
        USER_CONTROL_HINT,
      parameters: { type: 'object', properties: {}, required: [] },
    },
    permissionSpec('browser:restart'),
    async (_args, signal, context) => {
      try {
        const result = await session.restart(agentWriteOptions(signal, context));
        return success({ ok: true, ...result }, { pageStateLost: true });
      } catch (error) {
        return mapBrowserExecuteError(error, 'write');
      }
    },
  );

  const reload = createBrowserRegistration(
    {
      name: 'browser_reload',
      description:
        'Reload the current page. Host binds the live URL for permission; do not pass url.' +
        USER_CONTROL_HINT,
      parameters: { type: 'object', properties: {}, required: [] },
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
    async (args, signal, context) => {
      const expectedUrl = typeof args.url === 'string' ? args.url : '';
      const expectedPageId = typeof args.pageId === 'string' ? args.pageId : '';
      try {
        await session.reload({
          ...agentWriteOptions(signal, context),
          ...(expectedUrl !== '' ? { expectedUrl } : {}),
          ...(expectedPageId !== '' ? { expectedPageId } : {}),
        });
      } catch (error) {
        return mapBrowserExecuteError(error, 'reload');
      }
      const state = session.currentState();
      const payload = {
        ok: true as const,
        ...(state.url !== undefined ? { url: state.url } : {}),
      };
      return state.url !== undefined ? success(payload, { url: state.url }) : success(payload);
    },
    (rawArguments, context, signal) =>
      prepareBrowserReloadArgs(session, rawArguments, context, signal),
  );

  const pressKey = createBrowserRegistration(
    {
      name: 'browser_press_key',
      description:
        'Press a keyboard key or chord (Enter, Tab, Escape, Control+l, ArrowDown).' +
        USER_CONTROL_HINT,
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Key or chord, e.g. Enter, Tab, Escape, Control+l',
          },
        },
        required: ['key'],
      },
    },
    permissionSpec('browser:type'),
    async (args, signal, context) => {
      const key = String(args.key ?? '');
      try {
        await session.pressKey(key, agentWriteOptions(signal, context));
      } catch (error) {
        return mapBrowserExecuteError(error, 'key');
      }
      return success({ ok: true, key }, { key });
    },
    prepareBrowserPressKeyArgs,
  );

  const waitFor = createBrowserRegistration(
    {
      name: 'browser_wait_for',
      description:
        'Preferred wait for navigation, rendering and async results. Exactly one condition must be given: text, url, or selector (optional visible). Default timeout 10s.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to wait for (or to disappear if visible=false)' },
          url: { type: 'string', description: 'URL substring or absolute URL to wait for' },
          selector: { type: 'string', description: 'CSS selector to wait for' },
          visible: {
            type: 'boolean',
            description: 'With text or selector: wait until visible (default true) or hidden',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default 10000, capped)',
          },
        },
      },
    },
    permissionSpec('browser:wait'),
    async (args, signal) => {
      const timeoutMs = clampBrowserWaitForTimeout(args.timeout);
      if (timeoutMs === undefined) {
        return { ok: false, code: 'invalid-input', message: 'timeout must be a non-negative number' };
      }
      const condition: BrowserWaitForCondition = {
        ...(typeof args.text === 'string' ? { text: args.text } : {}),
        ...(typeof args.url === 'string' ? { url: args.url } : {}),
        ...(typeof args.selector === 'string' ? { selector: args.selector } : {}),
        ...(typeof args.visible === 'boolean' ? { visible: args.visible } : {}),
      };
      try {
        await session.waitFor(condition, { signal, timeoutMs });
      } catch (error) {
        return mapBrowserExecuteError(error, 'wait');
      }
      return success({ ok: true, ...condition }, { timeout: timeoutMs });
    },
    prepareBrowserWaitForArgs,
  );

  const viewport = createBrowserRegistration(
    {
      name: 'browser_viewport',
      description:
        'Query the Host CSS viewport without launching, or set it (action=set with width/height).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['query', 'set'], description: 'query (default) or set' },
          width: { type: 'number', description: 'CSS width when action=set' },
          height: { type: 'number', description: 'CSS height when action=set' },
          mode: {
            type: 'string',
            enum: ['fixed', 'follow', 'mobile', 'custom'],
            description: 'Viewport mode for set (default fixed)',
          },
        },
      },
    },
    {
      action: 'browser:viewport',
      risk: 'unknown',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: 'browser:viewport' }),
    },
    async (args, signal, context) => {
      const action = args.action === 'set' ? 'set' : 'query';
      if (action === 'query') {
        return success(session.queryViewport());
      }
      const mode = parseViewportMode(args.mode);
      const resolved = resolveBrowserViewport({
        ...(mode !== undefined ? { mode } : {}),
        ...(typeof args.width === 'number' ? { width: args.width } : {}),
        ...(typeof args.height === 'number' ? { height: args.height } : {}),
      });
      if (!resolved) {
        return { ok: false, code: 'invalid-input', message: 'viewport set requires a valid width and height' };
      }
      try {
        const size = await session.applyViewport(resolved, {
          ...agentWriteOptions(signal, context),
          ...(mode !== undefined ? { mode } : {}),
        });
        return success({ ok: true, ...size }, size);
      } catch (error) {
        return mapBrowserExecuteError(error, 'write');
      }
    },
    prepareBrowserViewportArgs,
  );

  return [
    navigate,
    snapshot,
    click,
    type,
    fillForm,
    scroll,
    screenshot,
    find,
    back,
    forward,
    wait,
    browserLock,
    status,
    restart,
    reload,
    pressKey,
    waitFor,
    viewport,
    ...createBrowserStageBcToolDefinitions(session, {
      projectRoot,
      createRegistration: createBrowserRegistration,
      permissionSpec,
      success,
      userControlHint: USER_CONTROL_HINT,
      agentWriteOptions,
      resolveTarget,
      mapExecuteError: mapBrowserExecuteError,
      abortedPreparation,
      invalidPreparation,
      normalizePath: normalizeScreenshotPath,
    }),
  ];
}

/**
 * Optional ref-or-selector target. Unlike `resolveTarget`, a missing target is
 * valid here: scroll falls back to the page root (spec §6.3).
 */
function optionalTarget(args: Record<string, unknown>): string | undefined {
  if (typeof args.ref === 'string' && args.ref !== '') return args.ref;
  if (typeof args.selector === 'string' && args.selector !== '') return args.selector;
  return undefined;
}

function resolveScrollAmount(value: unknown): number | undefined {
  if (value === undefined) return BROWSER_SCROLL_DEFAULT_AMOUNT_PX;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > BROWSER_SCROLL_MAX_AMOUNT_PX) return undefined;
  return rounded;
}

/** Resolve a ref-or-selector target from tool args. Refs take precedence. */
function resolveTarget(args: Record<string, unknown>): string {
  if (typeof args.ref === 'string' && args.ref !== '') return args.ref;
  if (typeof args.selector === 'string' && args.selector !== '') return args.selector;
  throw new Error('browser tool requires a ref or selector argument');
}

function prepareBrowserReloadArgs(
  session: BrowserSession,
  rawArguments: Record<string, unknown>,
  _context: HostToolExecutionContext,
  signal: AbortSignal,
): HostToolArgumentPreparation {
  if (signal.aborted) return abortedPreparation();
  const url = session.currentState().url;
  const pageId = session.status().pageId;
  if (
    typeof url !== 'string' ||
    url.trim().length === 0 ||
    typeof pageId !== 'string' ||
    pageId.length === 0
  ) {
    return invalidPreparation('reload requires an open page with a URL');
  }
  const rest = Object.fromEntries(
    Object.entries(rawArguments).filter(([key]) => key !== 'url' && key !== 'pageId'),
  );
  return { ok: true, arguments: { ...rest, url: url.trim(), pageId } };
}

function prepareBrowserPressKeyArgs(
  rawArguments: Record<string, unknown>,
  _context: HostToolExecutionContext,
  signal: AbortSignal,
): HostToolArgumentPreparation {
  if (signal.aborted) return abortedPreparation();
  const key = typeof rawArguments.key === 'string' ? rawArguments.key.trim() : '';
  if (!isValidBrowserKey(key)) {
    return invalidPreparation('key must be a valid key name or chord (e.g. Enter, Tab, Control+l)');
  }
  return { ok: true, arguments: { ...rawArguments, key } };
}

function prepareBrowserWaitForArgs(
  rawArguments: Record<string, unknown>,
  _context: HostToolExecutionContext,
  signal: AbortSignal,
): HostToolArgumentPreparation {
  if (signal.aborted) return abortedPreparation();
  const text =
    typeof rawArguments.text === 'string' && rawArguments.text.length > 0 ? rawArguments.text : undefined;
  const url =
    typeof rawArguments.url === 'string' && rawArguments.url.length > 0 ? rawArguments.url : undefined;
  const selector =
    typeof rawArguments.selector === 'string' && rawArguments.selector.length > 0
      ? rawArguments.selector
      : undefined;
  const count =
    Number(text !== undefined) + Number(url !== undefined) + Number(selector !== undefined);
  if (count !== 1) {
    return invalidPreparation('wait_for requires exactly one of text, url, or selector');
  }
  if (rawArguments.visible !== undefined && typeof rawArguments.visible !== 'boolean') {
    return invalidPreparation('visible must be a boolean');
  }
  if (url !== undefined && rawArguments.visible !== undefined) {
    return invalidPreparation('visible cannot be combined with url');
  }
  const timeoutMs = clampBrowserWaitForTimeout(rawArguments.timeout);
  if (timeoutMs === undefined) {
    return invalidPreparation('timeout must be a non-negative number');
  }
  return {
    ok: true,
    arguments: {
      timeout: timeoutMs,
      ...(text !== undefined ? { text } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(selector !== undefined ? { selector } : {}),
      ...(typeof rawArguments.visible === 'boolean' ? { visible: rawArguments.visible } : {}),
    },
  };
}

function prepareBrowserViewportArgs(
  rawArguments: Record<string, unknown>,
  _context: HostToolExecutionContext,
  signal: AbortSignal,
): HostToolArgumentPreparation {
  if (signal.aborted) return abortedPreparation();
  const rawAction = rawArguments.action;
  if (rawAction !== undefined && rawAction !== 'query' && rawAction !== 'set') {
    return invalidPreparation('action must be query or set');
  }
  const hasSize =
    typeof rawArguments.width === 'number' || typeof rawArguments.height === 'number';
  const action = rawAction === 'set' || (rawAction === undefined && hasSize) ? 'set' : 'query';
  if (action === 'query') {
    return { ok: true, arguments: { action: 'query' } };
  }
  const width = rawArguments.width;
  const height = rawArguments.height;
  if (typeof width !== 'number' || typeof height !== 'number' || width < 1 || height < 1) {
    return invalidPreparation('viewport set requires positive width and height');
  }
  const mode = parseViewportMode(rawArguments.mode);
  if (rawArguments.mode !== undefined && mode === undefined) {
    return invalidPreparation('mode must be fixed, follow, mobile, or custom');
  }
  return {
    ok: true,
    arguments: {
      action: 'set',
      width,
      height,
      ...(mode !== undefined ? { mode } : {}),
    },
  };
}

function parseViewportMode(value: unknown): BrowserViewportMode | undefined {
  if (value === 'fixed' || value === 'follow' || value === 'mobile' || value === 'custom') {
    return value;
  }
  return undefined;
}

