import type { CompactionDelegationTarget } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type { PiModelRegistration, PiModelRuntime } from './pi-model-runtime.js';

export const COMPACTION_DELEGATION_EXTENSION_PATH = 'piwin://compaction-delegation';

type CompactionHookHandler = (
  event: Record<string, unknown>,
  ctx: Record<string, unknown>,
) => Promise<{ cancel?: boolean; compaction?: unknown } | undefined>;

type MutableResourceLoader = {
  getExtensions?: () => {
    extensions?: Array<{
      path?: string;
      resolvedPath?: string;
      handlers?: Map<string, CompactionHookHandler[]>;
      tools?: Map<string, unknown>;
      messageRenderers?: Map<string, unknown>;
      commands?: Map<string, unknown>;
      flags?: Map<string, unknown>;
      shortcuts?: Map<string, unknown>;
    }>;
  };
};

export type CompactionModelRuntime = PiModelRuntime & {
  getAuth?: (
    model: PiModelRegistration,
  ) => Promise<
    | {
        auth: {
          apiKey?: string;
          headers?: Record<string, string | null>;
          baseUrl?: string;
        };
        env?: Record<string, string>;
      }
    | undefined
  >;
  isUsingOAuth?: (providerId: string) => boolean;
  streamSimple?: (model: unknown, context: unknown, options?: unknown) => unknown;
};

export type PiCompactFunction = (
  preparation: unknown,
  model: unknown,
  apiKey: string | undefined,
  headers?: Record<string, string>,
  customInstructions?: string,
  signal?: AbortSignal,
  thinkingLevel?: unknown,
  streamFn?: (model: unknown, context: unknown, options?: unknown) => unknown,
  env?: Record<string, string>,
  retry?: unknown,
  callbacks?: unknown,
) => Promise<unknown>;

export type CompactionDelegationFailureState = {
  record: (message: string) => void;
  clear: () => void;
  consume: () => string | undefined;
  transformEvent: (rawEvent: unknown) => unknown;
  runCompact: <T>(execute: () => Promise<T>) => Promise<T>;
};

export function createCompactionDelegationState(): CompactionDelegationFailureState {
  let pendingFailure: string | undefined;

  return {
    record(message: string) {
      pendingFailure = message;
    },
    clear() {
      pendingFailure = undefined;
    },
    consume() {
      const failure = pendingFailure;
      pendingFailure = undefined;
      return failure;
    },
    transformEvent(rawEvent: unknown): unknown {
      if (!rawEvent || typeof rawEvent !== 'object') {
        return rawEvent;
      }
      const event = rawEvent as Record<string, unknown>;
      if (event.type === 'compaction_start') {
        pendingFailure = undefined;
        return rawEvent;
      }
      if (event.type === 'compaction_end' && event.aborted === true && pendingFailure) {
        return {
          ...event,
          aborted: false,
          errorMessage: pendingFailure,
        };
      }
      return rawEvent;
    },
    async runCompact<T>(execute: () => Promise<T>): Promise<T> {
      try {
        return await execute();
      } catch (error) {
        const failure = pendingFailure;
        pendingFailure = undefined;
        if (failure) {
          throw new Error(failure);
        }
        throw error;
      }
    },
  };
}

export type InstallCompactionDelegationOptions = {
  resourceLoader: unknown;
  delegation: CompactionDelegationTarget;
  getModelRuntime: () => CompactionModelRuntime | undefined;
  getRetrySettings?: () => unknown;
  piModule?: Record<string, unknown>;
  state: CompactionDelegationFailureState;
};

/**
 * Prepend a synthetic highest-priority `session_before_compact` extension
 * that routes all manual and auto compaction through `delegation.model`.
 */
export function installCompactionDelegationHook(
  options: InstallCompactionDelegationOptions,
): boolean {
  const loader = options.resourceLoader as MutableResourceLoader | null | undefined;
  const loaded = loader?.getExtensions?.();
  if (!loaded || !Array.isArray(loaded.extensions)) {
    return false;
  }

  const handler = createCompactionDelegationHandler(options);
  const existingIndex = loaded.extensions.findIndex(
    (ext) => ext?.path === COMPACTION_DELEGATION_EXTENSION_PATH,
  );
  if (existingIndex >= 0) {
    loaded.extensions.splice(existingIndex, 1);
  }
  loaded.extensions.unshift({
    path: COMPACTION_DELEGATION_EXTENSION_PATH,
    resolvedPath: COMPACTION_DELEGATION_EXTENSION_PATH,
    handlers: new Map<string, CompactionHookHandler[]>([['session_before_compact', [handler]]]),
    tools: new Map(),
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  });
  return true;
}

function createCompactionDelegationHandler(
  options: InstallCompactionDelegationOptions,
): CompactionHookHandler {
  const { providerId, modelId } = options.delegation.model;
  return async (event, ctx) => {
    options.state.clear();
    const signal = event.signal instanceof AbortSignal ? event.signal : undefined;
    if (signal?.aborted) {
      return { cancel: true };
    }

    try {
      const runtime = options.getModelRuntime();
      const ctxRegistry = ctx.modelRegistry as
        | {
            find?: (provider: string, id: string) => PiModelRegistration | undefined;
            getApiKeyAndHeaders?: (
              model: PiModelRegistration,
            ) => Promise<
              | {
                  ok: true;
                  apiKey?: string;
                  headers?: Record<string, string>;
                  baseUrl?: string;
                  env?: Record<string, string>;
                }
              | { ok: false; error: string }
            >;
          }
        | undefined;

      const delegateModel =
        runtime?.getModel(providerId, modelId) ?? ctxRegistry?.find?.(providerId, modelId);
      if (!delegateModel) {
        throw new Error(`model "${providerId}/${modelId}" is unavailable or disabled`);
      }

      const auth = await resolveDelegateAuth(runtime, ctxRegistry, delegateModel, providerId);
      const compactFn = await resolvePiCompactFunction(options.piModule);
      const runtimeStreamSimple =
        runtime && typeof runtime.streamSimple === 'function'
          ? runtime.streamSimple.bind(runtime)
          : undefined;
      const streamFn = runtimeStreamSimple
        ? (model: unknown, context: unknown, requestOptions?: unknown) =>
            runtimeStreamSimple(model, context, requestOptions)
        : undefined;
      const customInstructions =
        typeof event.customInstructions === 'string' ? event.customInstructions : undefined;
      const retrySettings = options.getRetrySettings?.();
      const result = await compactFn(
        event.preparation,
        auth.requestModel,
        auth.apiKey,
        auth.headers,
        customInstructions,
        signal,
        ctx.thinkingLevel,
        streamFn,
        auth.env,
        retrySettings,
      );
      if (signal?.aborted) {
        options.state.clear();
        return { cancel: true };
      }
      return { compaction: result };
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        options.state.clear();
        return { cancel: true };
      }
      options.state.record(
        `Compaction delegation failed (${providerId}/${modelId}): ${formatError(error)}`,
      );
      // Cancel Pi's default compact so we never silently fall back to the main model.
      return { cancel: true };
    }
  };
}

async function resolveDelegateAuth(
  runtime: CompactionModelRuntime | undefined,
  ctxRegistry:
    | {
        getApiKeyAndHeaders?: (
          model: PiModelRegistration,
        ) => Promise<
          | {
              ok: true;
              apiKey?: string;
              headers?: Record<string, string | null>;
              baseUrl?: string;
              env?: Record<string, string>;
            }
          | { ok: false; error: string }
        >;
      }
    | undefined,
  model: PiModelRegistration,
  providerId: string,
): Promise<{
  requestModel: PiModelRegistration;
  apiKey: string | undefined;
  headers: Record<string, string> | undefined;
  env: Record<string, string> | undefined;
}> {
  if (typeof ctxRegistry?.getApiKeyAndHeaders === 'function') {
    const resolved = await ctxRegistry.getApiKeyAndHeaders(model);
    if (!resolved.ok) {
      if (runtime?.isUsingOAuth?.(providerId)) {
        throw new Error(
          `Authentication failed for "${providerId}". Credentials may have expired.`,
        );
      }
      throw new Error(resolved.error);
    }
    const requestModel = resolved.baseUrl ? { ...model, baseUrl: resolved.baseUrl } : model;
    return {
      requestModel,
      apiKey: resolved.apiKey,
      headers: stripDeletedHeaders(resolved.headers),
      env: resolved.env,
    };
  }
  if (typeof runtime?.getAuth === 'function') {
    const resolved = await runtime.getAuth(model);
    if (!resolved) {
      if (runtime.isUsingOAuth?.(providerId)) {
        throw new Error(
          `Authentication failed for "${providerId}". Credentials may have expired.`,
        );
      }
      return {
        requestModel: model,
        apiKey: undefined,
        headers: undefined,
        env: undefined,
      };
    }
    const requestModel = resolved.auth.baseUrl
      ? { ...model, baseUrl: resolved.auth.baseUrl }
      : model;
    return {
      requestModel,
      apiKey: resolved.auth.apiKey,
      headers: stripDeletedHeaders(resolved.auth.headers),
      env: resolved.env,
    };
  }
  return {
    requestModel: model,
    apiKey: undefined,
    headers: undefined,
    env: undefined,
  };
}

function stripDeletedHeaders(
  headers: Record<string, string | null> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      clean[key] = value;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

async function resolvePiCompactFunction(
  piModule?: Record<string, unknown>,
): Promise<PiCompactFunction> {
  if (typeof piModule?.compact === 'function') {
    return piModule.compact as PiCompactFunction;
  }
  const loaded = (await import('@earendil-works/pi-coding-agent')) as {
    compact?: unknown;
  };
  if (typeof loaded.compact !== 'function') {
    throw new Error('compact export missing from @earendil-works/pi-coding-agent');
  }
  return loaded.compact as PiCompactFunction;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'AbortError' || error.message === 'Compaction cancelled';
}
