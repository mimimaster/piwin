/**
 * Stage B/C browser tools: hover/select/check, tabs/dialog, upload, console/network.
 */
import { existsSync, statSync } from 'node:fs';
import type {
  HostToolArgumentPreparation,
  HostToolDescriptor,
  HostToolExecutionContext,
  HostToolExecutor,
  HostToolPermissionSpec,
  HostToolRegistration,
  ToolResult,
  ToolResultImage,
} from '@piwin/contracts';
import type { BrowserOpOptions, BrowserSession } from '@piwin/browser';

export type BrowserStageBcHelpers = {
  projectRoot: string;
  createRegistration: (
    descriptor: HostToolDescriptor,
    permissionSpec: HostToolPermissionSpec,
    execute: HostToolExecutor,
    prepareArgs?: HostToolRegistration['prepareArgs'],
  ) => HostToolRegistration;
  permissionSpec: (action: string, projectRoot?: string) => HostToolPermissionSpec;
  success: (
    output: unknown,
    details?: Record<string, unknown>,
    images?: ToolResultImage[],
  ) => ToolResult;
  userControlHint: string;
  agentWriteOptions: (signal: AbortSignal, context: HostToolExecutionContext) => BrowserOpOptions;
  resolveTarget: (args: Record<string, unknown>) => string;
  mapExecuteError: (
    error: unknown,
    kind: 'write' | 'wait' | 'reload' | 'key' | 'click',
  ) => ToolResult;
  abortedPreparation: () => HostToolArgumentPreparation;
  invalidPreparation: (message: string) => HostToolArgumentPreparation;
  normalizePath: (value: unknown, projectRoot: string) => string | undefined;
};

export function createBrowserStageBcToolDefinitions(
  session: BrowserSession,
  helpers: BrowserStageBcHelpers,
): HostToolRegistration[] {
  const {
    projectRoot,
    createRegistration,
    permissionSpec,
    success,
    userControlHint,
    agentWriteOptions,
    resolveTarget,
    mapExecuteError,
    abortedPreparation,
    invalidPreparation,
    normalizePath,
  } = helpers;

  const hover = createRegistration(
    {
      name: 'browser_hover',
      description: 'Hover over a page element targeting a snapshot ref or CSS selector.' + userControlHint,
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
        await session.hover(target, agentWriteOptions(signal, context));
      } catch (error) {
        return mapExecuteError(error, 'click');
      }
      return success({ ok: true, target }, { target });
    },
  );

  const selectOption = createRegistration(
    {
      name: 'browser_select_option',
      description: 'Select one or more options in a <select> element.' + userControlHint,
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from browser_snapshot (e.g. e5)' },
          selector: { type: 'string', description: 'CSS selector (used when ref is omitted)' },
          values: {
            type: 'array',
            items: { type: 'string' },
            description: 'Option values, labels, or indices to select',
          },
          value: { type: 'string', description: 'Single option when values is omitted' },
        },
      },
    },
    permissionSpec('browser:click'),
    async (args, signal, context) => {
      const target = resolveTarget(args);
      const values = resolveSelectValues(args);
      try {
        await session.selectOption(target, values, agentWriteOptions(signal, context));
      } catch (error) {
        return mapExecuteError(error, 'write');
      }
      return success({ ok: true, target, values }, { target, values });
    },
    (rawArguments, _context, signal) => {
      if (signal.aborted) return abortedPreparation();
      try {
        resolveTarget(rawArguments);
      } catch {
        return invalidPreparation('browser tool requires a ref or selector argument');
      }
      if (resolveSelectValues(rawArguments).length === 0) {
        return invalidPreparation('select_option requires value or values');
      }
      return { ok: true, arguments: rawArguments };
    },
  );

  const setChecked = createRegistration(
    {
      name: 'browser_set_checked',
      description: 'Check or uncheck a checkbox or radio input.' + userControlHint,
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from browser_snapshot (e.g. e5)' },
          selector: { type: 'string', description: 'CSS selector (used when ref is omitted)' },
          checked: { type: 'boolean', description: 'Checked state (default true)' },
        },
      },
    },
    permissionSpec('browser:click'),
    async (args, signal, context) => {
      const target = resolveTarget(args);
      const checked = args.checked !== false;
      try {
        await session.setChecked(target, checked, agentWriteOptions(signal, context));
      } catch (error) {
        return mapExecuteError(error, 'write');
      }
      return success({ ok: true, target, checked }, { target, checked });
    },
  );

  const tabs = createRegistration(
    {
      name: 'browser_tabs',
      description:
        'List, open, select, or close workbench tabs. pageId is stable for this session. Popups are listed as kind=popup and are not auto-selected.' +
        userControlHint,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'new', 'select', 'close'],
            description: 'list (default), new, select, or close',
          },
          pageId: { type: 'string', description: 'Required for select and close' },
          url: { type: 'string', description: 'Optional URL when action=new' },
        },
      },
    },
    {
      action: 'browser:tabs',
      risk: 'network',
      rememberable: true,
      subjectBuilder: (args) => {
        if (args.action === 'new' && typeof args.url === 'string' && args.url.trim() !== '') {
          try {
            return { kind: 'web-fetch', host: new URL(args.url).hostname };
          } catch {
            return undefined;
          }
        }
        return { kind: 'tool', action: 'browser:tabs' };
      },
    },
    async (args, signal, context) => {
      const action = args.action === 'new' || args.action === 'select' || args.action === 'close'
        ? args.action
        : 'list';
      try {
        if (action === 'list') {
          const listed = await session.listTabs({ signal });
          return success({ tabs: listed }, { count: listed.length });
        }
        const write = agentWriteOptions(signal, context);
        if (action === 'new') {
          const url = typeof args.url === 'string' ? args.url : undefined;
          const tab = await session.newTab(url, write);
          return success({ ok: true, tab }, { pageId: tab.pageId });
        }
        const pageId = String(args.pageId ?? '');
        if (action === 'select') {
          const tab = await session.selectTab(pageId, write);
          return success({ ok: true, tab }, { pageId: tab.pageId });
        }
        await session.closeTab(pageId, write);
        return success({ ok: true, pageId }, { pageId });
      } catch (error) {
        return mapExecuteError(error, 'write');
      }
    },
    (rawArguments, _context, signal) => {
      if (signal.aborted) return abortedPreparation();
      const rawAction = rawArguments.action;
      if (
        rawAction !== undefined &&
        rawAction !== 'list' &&
        rawAction !== 'new' &&
        rawAction !== 'select' &&
        rawAction !== 'close'
      ) {
        return invalidPreparation('action must be list, new, select, or close');
      }
      const action =
        rawAction === 'new' || rawAction === 'select' || rawAction === 'close' ? rawAction : 'list';
      if ((action === 'select' || action === 'close') && typeof rawArguments.pageId !== 'string') {
        return invalidPreparation('pageId is required for select and close');
      }
      if (action === 'new' && rawArguments.url !== undefined) {
        if (typeof rawArguments.url !== 'string' || rawArguments.url.trim() === '') {
          return invalidPreparation('url must be http(s)');
        }
        const url = rawArguments.url.trim();
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return invalidPreparation('url must be http(s)');
          }
        } catch {
          return invalidPreparation('url is invalid');
        }
        return { ok: true, arguments: { ...rawArguments, action, url } };
      }
      return { ok: true, arguments: { ...rawArguments, action } };
    },
  );

  const dialog = createRegistration(
    {
      name: 'browser_dialog',
      description:
        'Accept or dismiss the current page dialog (alert/confirm/prompt). Times out instead of hanging.' +
        userControlHint,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['accept', 'dismiss'],
            description: 'accept or dismiss',
          },
          promptText: { type: 'string', description: 'Text for prompt dialogs when accepting' },
        },
        required: ['action'],
      },
    },
    permissionSpec('browser:dialog'),
    async (args, signal, context) => {
      const action = args.action === 'accept' ? 'accept' : 'dismiss';
      const promptText = typeof args.promptText === 'string' ? args.promptText : undefined;
      try {
        const result = await session.handleDialog(action, promptText, agentWriteOptions(signal, context));
        return success({ ok: true, ...result });
      } catch (error) {
        if (error instanceof Error && /timed out/i.test(error.message)) {
          return {
            ok: false,
            code: 'browser-action-failed',
            message: error.message,
            retryable: false,
            details: { reason: 'timeout' },
          };
        }
        return mapExecuteError(error, 'write');
      }
    },
    (rawArguments, _context, signal) => {
      if (signal.aborted) return abortedPreparation();
      if (rawArguments.action !== 'accept' && rawArguments.action !== 'dismiss') {
        return invalidPreparation('action must be accept or dismiss');
      }
      return { ok: true, arguments: rawArguments };
    },
  );

  const upload = createRegistration(
    {
      name: 'browser_upload',
      description:
        'Set files on a file input from Host-accessible paths. Paths are gated by file permission.' +
        userControlHint,
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from browser_snapshot (e.g. e5)' },
          selector: { type: 'string', description: 'CSS selector (used when ref is omitted)' },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Host file paths to upload',
          },
          path: { type: 'string', description: 'Single Host file path when paths is omitted' },
        },
      },
    },
    {
      action: 'browser:upload',
      risk: 'file-write',
      rememberable: false,
      subjectBuilder: (args) => {
        const files = resolveUploadPaths(args, projectRoot, normalizePath);
        const first = files[0];
        return first !== undefined
          ? { kind: 'file-write', path: first }
          : { kind: 'tool', action: 'browser:upload' };
      },
    },
    async (args, signal, context) => {
      const target = resolveTarget(args);
      const files = resolveUploadPaths(args, projectRoot, normalizePath);
      try {
        await session.uploadFiles(target, files, agentWriteOptions(signal, context));
      } catch (error) {
        return mapExecuteError(error, 'write');
      }
      return success({ ok: true, target, paths: files }, { count: files.length });
    },
    (rawArguments, _context, signal) => {
      if (signal.aborted) return abortedPreparation();
      try {
        resolveTarget(rawArguments);
      } catch {
        return invalidPreparation('browser tool requires a ref or selector argument');
      }
      const files = resolveUploadPaths(rawArguments, projectRoot, normalizePath);
      if (files.length === 0) {
        return invalidPreparation('upload requires path or paths');
      }
      for (const file of files) {
        if (!existsSync(file) || !statSync(file).isFile()) {
          return invalidPreparation(`upload file is not readable: ${file}`);
        }
      }
      return { ok: true, arguments: { ...rawArguments, paths: files } };
    },
  );

  const consoleQuery = createRegistration(
    {
      name: 'browser_console',
      description: 'Read the bounded console log buffer for the workbench (no evaluate).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max entries to return (most recent)' },
        },
      },
    },
    permissionSpec('browser:console'),
    async (args) => {
      const limit = typeof args.limit === 'number' ? args.limit : undefined;
      const entries = session.queryConsole(limit);
      return success({ entries }, { count: entries.length });
    },
  );

  const networkQuery = createRegistration(
    {
      name: 'browser_network',
      description:
        'Read the bounded network and download buffers for the workbench. Downloads are Host file refs, not remote Desktop paths.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max entries to return (most recent)' },
        },
      },
    },
    permissionSpec('browser:network'),
    async (args) => {
      const limit = typeof args.limit === 'number' ? args.limit : undefined;
      const entries = session.queryNetwork(limit);
      const downloads = session.queryDownloads(limit);
      return success({ entries, downloads }, { count: entries.length, downloads: downloads.length });
    },
  );

  return [hover, selectOption, setChecked, tabs, dialog, upload, consoleQuery, networkQuery];
}

function resolveSelectValues(args: Record<string, unknown>): string[] {
  if (Array.isArray(args.values)) {
    return args.values.filter((value): value is string => typeof value === 'string' && value !== '');
  }
  if (typeof args.value === 'string' && args.value !== '') return [args.value];
  return [];
}

function resolveUploadPaths(
  args: Record<string, unknown>,
  projectRoot: string,
  normalizePath: (value: unknown, projectRoot: string) => string | undefined,
): string[] {
  if (Array.isArray(args.paths)) {
    return args.paths
      .map((value) => normalizePath(value, projectRoot))
      .filter((value): value is string => value !== undefined);
  }
  const single = normalizePath(args.path, projectRoot);
  return single !== undefined ? [single] : [];
}
