/**
 * Shared browser tool plumbing: registration wrapper, result builders, permission
 * specs and argument-preparation helpers. Extracted so the tool factories stay
 * under the repository file-size cap (AGENTS.md §3.2).
 */
import { resolve as resolvePath } from 'node:path';
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
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import { readBrowserPageState } from './browser-tool-page-state.js';


export function createBrowserRegistration(
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

export function success(
  output: unknown,
  details?: Record<string, unknown>,
  images?: ToolResultImage[],
): ToolResult {
  return {
    ok: true,
    output: typeof output === 'string' ? output : JSON.stringify(output),
    ...(details ? { details } : {}),
    ...(images && images.length > 0 ? { images } : {}),
  };
}

export function successWithPage(
  session: BrowserSession,
  payload: Record<string, unknown>,
  details?: Record<string, unknown>,
): ToolResult {
  const page = readBrowserPageState(session);
  return success({ ...payload, ...(page ? { page } : {}) }, details);
}

/**
 * The page was captured, but no pixels reached the model. Reporting this as a
 * plain success invites the model to claim visual verification it cannot have.
 */
export function screenshotEvidenceFailure(base: Record<string, unknown>, reason: string): ToolResult {
  return success(
    {
      status: 'success',
      ...base,
      evidence: { status: 'unavailable', reason },
      notice: `Capture succeeded but no pixels reached the model (${reason}). This is not visual verification.`,
    },
    { ...base, evidence: 'unavailable', evidenceReason: reason },
  );
}

export function prepareBrowserTargetArgs(
  rawArguments: Record<string, unknown>,
  _context: HostToolExecutionContext,
  signal: AbortSignal,
): HostToolArgumentPreparation {
  if (signal.aborted) return abortedPreparation();
  const ref = rawArguments.ref;
  const selector = rawArguments.selector;
  const hasRef = typeof ref === 'string' && ref.trim().length > 0;
  const hasSelector = typeof selector === 'string' && selector.trim().length > 0;
  if (!hasRef && !hasSelector) {
    return invalidPreparation('browser tool requires a ref or selector argument');
  }
  return { ok: true, arguments: rawArguments };
}


export function agentWriteOptions(
  signal: AbortSignal,
  context: HostToolExecutionContext,
): BrowserOpOptions {
  return { signal, actor: 'agent', runId: context.runId };
}

export function permissionSpec(action: string, projectRoot = process.cwd()): HostToolPermissionSpec {
  const readOnlyActions = new Set([
    'browser:snapshot',
    'browser:find',
    'browser:wait',
    'browser:status',
    'browser:console',
    'browser:network',
  ]);
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

/**
 * Keep routed browser calls tolerant of the common `query` spelling while
 * preserving the canonical model-facing schema (`text`).
 */
export function prepareBrowserFindArgs(
  rawArguments: Record<string, unknown>,
  _context: HostToolExecutionContext,
  signal: AbortSignal,
): HostToolArgumentPreparation {
  if (signal.aborted) {
    return {
      ok: false,
      result: { ok: false, code: 'aborted', message: 'tool preparation aborted' },
    };
  }

  const directText = rawArguments.text;
  const legacyQuery = rawArguments.query;
  const text =
    typeof directText === 'string' && directText.trim().length > 0
      ? directText
      : typeof legacyQuery === 'string'
        ? legacyQuery
        : undefined;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return {
      ok: false,
      result: { ok: false, code: 'invalid-input', message: 'text is required' },
    };
  }

  const canonicalArguments = Object.fromEntries(
    Object.entries(rawArguments).filter(([key]) => key !== 'query'),
  );
  return { ok: true, arguments: { ...canonicalArguments, text } };
}

export function normalizeScreenshotPath(value: unknown, projectRoot: string): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  return resolvePath(projectRoot, value.trim());
}

export function abortedPreparation(): HostToolArgumentPreparation {
  return {
    ok: false,
    result: { ok: false, code: 'aborted', message: 'tool preparation aborted' },
  };
}

export function invalidPreparation(message: string): HostToolArgumentPreparation {
  return { ok: false, result: { ok: false, code: 'invalid-input', message } };
}
