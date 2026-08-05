/**
 * Walkthrough host command handlers (spec §11).
 *
 * These handlers own the generation state machine (§11.2), concurrency rules
 * (§11.3) and the async fire-and-forget completion pipeline. They never call
 * `SessionHandle.prompt()`, `steer()` or `followUp()` — walkthrough generation
 * is a Pi-session-independent provider completion, not a new agent turn.
 *
 * The handlers depend only on the {@link WalkthroughCommandContext} seam, so
 * the SDK and RPC hosts share the exact same command contract (spec §11.1).
 */
import { randomUUID } from 'node:crypto';
import type {
  HostCommand,
  HostPush,
  HostResponse,
  ModelProviderConfig,
  ModelRef,
  PiwinConfig,
  SessionPlan,
  SessionTranscriptMessage,
  WalkthroughArtifact,
  WalkthroughConfig,
  WalkthroughError,
  WalkthroughErrorCode,
  WalkthroughMode,
} from '@piwin/contracts';
import { createDefaultWalkthroughConfig } from '@piwin/contracts';
import {
  collectWalkthroughEvidence,
  assembleSystemPrompt,
  assembleUserPrompt,
  computeSourceHashFromBounded,
  isWalkthroughEligibleMessage,
  redactAndBoundEvidence,
} from '../walkthrough-source.js';
import {
  completeWalkthrough,
  WalkthroughCompletionError,
  type WalkthroughCompletionDependencies,
} from '../walkthrough-completion.js';
import { listWalkthroughs, loadWalkthrough, saveWalkthrough } from '../walkthrough-store.js';
import { getPiwinRoot } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import { findEnabledProvider, resolveConfiguredDefaultModelRef } from '../provider-helpers.js';

/* ------------------------------------------------------------------ */
/* §11.1 Command context seam                                          */
/* ------------------------------------------------------------------ */

/**
 * Seam used by walkthrough command handlers. HostRuntime provides this via the
 * optional `walkthrough` bag on {@link HostCommandContext}; SDK and RPC hosts
 * share the same seam so both transports work through one command contract.
 */
export type WalkthroughCommandContext = {
  piwinRoot?: string;
  push: (message: HostPush) => void;
  loadTranscriptMessages: (sessionId: string) => Promise<SessionTranscriptMessage[]>;
  loadSessionPlan: (sessionId: string) => Promise<SessionPlan | null>;
  loadConfig: () => Promise<PiwinConfig>;
  /**
   * Returns the model most recently used by a live session, or undefined when
   * no live session model is tracked. Used as the second resolution tier for
   * default mode (spec §4.3).
   */
  resolveSessionModel: (sessionId: string) => ModelRef | undefined;
};

/* ------------------------------------------------------------------ */
/* §11.3 Concurrency: in-flight generation registry                     */
/* ------------------------------------------------------------------ */

type InFlightGeneration = {
  generationId: string;
  abortController: AbortController;
};

/**
 * Global in-flight generation registry (spec §11.3).
 *
 * Tracks at most one generation per `sessionId:messageId`. Cancel matches by
 * `generationId` so a stale generation cannot cancel a newer one. When a
 * generation completes, the registry checks whether it is still the current
 * generation for that message before the result is persisted/pushed; stale
 * results are discarded with a safe host log (§11.3).
 */
export class WalkthroughGenerationRegistry {
  private readonly inflight = new Map<string, InFlightGeneration>();
  private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void;

  constructor(log: (level: 'info' | 'warn' | 'error', message: string) => void = () => {}) {
    this.log = log;
  }

  private key(sessionId: string, messageId: string): string {
    return `${sessionId}:${messageId}`;
  }

  /**
   * Returns the in-flight generation for a message, if any. Used by generate
   * to dedupe and by cancel to find the AbortController.
   */
  get(sessionId: string, messageId: string): InFlightGeneration | undefined {
    return this.inflight.get(this.key(sessionId, messageId));
  }

  /**
   * Registers a new generation. Caller is responsible for checking `get`
   * first to enforce the "at most one in-flight per message" rule.
   */
  register(sessionId: string, messageId: string, generationId: string): AbortController {
    const abortController = new AbortController();
    this.inflight.set(this.key(sessionId, messageId), { generationId, abortController });
    return abortController;
  }

  /**
   * Aborts the in-flight generation for a message when `generationId` matches
   * (or when `generationId` is omitted). Returns true when an abort was issued.
   * A stale `generationId` never aborts a newer generation (§11.3).
   */
  abort(sessionId: string, messageId: string, generationId?: string): boolean {
    const existing = this.inflight.get(this.key(sessionId, messageId));
    if (!existing) {
      return false;
    }
    if (generationId !== undefined && generationId !== existing.generationId) {
      return false;
    }
    existing.abortController.abort();
    // Do NOT delete the inflight entry here: the async completion pipeline
    // checks `isCurrent` before publishing its result (§11.3). If we deleted
    // the entry on abort, that check would treat the cancelled generation as
    // stale and silently drop the `cancelled` error artifact the UI expects.
    // The entry is removed by `complete()` once the pipeline finishes.
    return true;
  }

  /**
   * Returns true when `generationId` is still the current generation for the
   * message. Used by the async completion to decide whether to persist/push
   * the result or discard it as stale (§11.3).
   */
  isCurrent(sessionId: string, messageId: string, generationId: string): boolean {
    const existing = this.inflight.get(this.key(sessionId, messageId));
    return existing?.generationId === generationId;
  }

  /**
   * Removes the in-flight entry. Called after a generation completes (success,
   * error or cancel) so a later `force` generate can start fresh.
   */
  complete(sessionId: string, messageId: string, generationId: string): void {
    const existing = this.inflight.get(this.key(sessionId, messageId));
    if (existing?.generationId === generationId) {
      this.inflight.delete(this.key(sessionId, messageId));
    }
  }

  /** Discards a stale result with a safe host log (§11.3). */
  discardStale(sessionId: string, messageId: string, generationId: string): void {
    this.log(
      'info',
      `walkthrough: discarding stale generation ${generationId} for ${sessionId}:${messageId}`,
    );
  }

  /**
   * Aborts all in-flight generations for a session (spec §11.3: session delete
   * or transcript truncate must abort related generations). Best-effort.
   */
  abortSession(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const [key, entry] of this.inflight.entries()) {
      if (key.startsWith(prefix)) {
        entry.abortController.abort();
        this.inflight.delete(key);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const WALKTHROUGH_COMMAND_TYPES = new Set<HostCommand['type']>([
  'walkthrough/list',
  'walkthrough/generate',
  'walkthrough/cancel',
]);

export function isWalkthroughCommand(command: HostCommand): boolean {
  return WALKTHROUGH_COMMAND_TYPES.has(command.type);
}

function walkthroughError(code: WalkthroughErrorCode, message: string): WalkthroughError {
  return { code, message };
}

/**
 * Validates that a ModelRef points to a configured provider and model, and that
 * the provider protocol matches (spec §4.4). Returns the provider config or an
 * error code.
 */
function resolveProviderForModel(
  model: ModelRef,
  config: PiwinConfig,
): { provider: ModelProviderConfig } | { provider?: undefined; error: WalkthroughErrorCode } {
  const provider = findEnabledProvider(config, model.providerId);
  if (!provider) {
    return { error: 'provider-not-found' };
  }
  if (provider.protocol !== model.protocol) {
    return { error: 'unsupported-provider' };
  }
  const modelExists = provider.models.some((m) => m.id === model.modelId);
  if (!modelExists) {
    return { error: 'model-not-configured' };
  }
  return { provider };
}

/**
 * Resolve the final model + provider + mode for a generation, applying spec
 * §4.3 (default) and §4.4 (custom) validation. Returns either the resolved
 * inputs or a WalkthroughError.
 */
export function resolveGenerationModel(
  command: Extract<HostCommand, { type: 'walkthrough/generate' }>,
  targetMessage: SessionTranscriptMessage,
  context: WalkthroughCommandContext,
  config: PiwinConfig,
): {
  model?: ModelRef;
  provider?: ModelProviderConfig;
  mode: WalkthroughMode;
  error?: WalkthroughError;
} {
  // ADR 0026: always use session/message/config default model.
  // No separate walkthrough model picker; custom.prompt is applied in assembleUserPrompt.
  const mode: WalkthroughMode = 'default';
  const model = resolveDefaultModeModelRef(targetMessage, command.sessionId, context, config);
  if (!model) {
    return {
      mode,
      error: walkthroughError(
        'model-unavailable',
        'No model is available for this message. Configure a provider model for the session.',
      ),
    };
  }
  const resolved = resolveProviderForModel(model, config);
  if ('error' in resolved) {
    return {
      mode,
      error: walkthroughError(
        resolved.error,
        `The model used for this message is no longer available (${resolved.error}).`,
      ),
    };
  }
  return { model, provider: resolved.provider, mode };
}

/**
 * Default-mode model resolution using the command's sessionId (the message
 * itself does not carry sessionId). Spec §4.3 order:
 * 1. message `model` snapshot;
 * 2. session saved model (via `resolveSessionModel`);
 * 3. config default provider+model.
 */
function resolveDefaultModeModelRef(
  targetMessage: SessionTranscriptMessage,
  sessionId: string,
  context: WalkthroughCommandContext,
  config: PiwinConfig,
): ModelRef | undefined {
  if (targetMessage.model) {
    return targetMessage.model;
  }
  const sessionModel = context.resolveSessionModel(sessionId);
  if (sessionModel) {
    return sessionModel;
  }
  if (config.defaultProviderId && config.defaultModelId) {
    const provider = config.providers.find((p) => p.id === config.defaultProviderId);
    if (provider) {
      return {
        protocol: provider.protocol,
        providerId: provider.id,
        modelId: config.defaultModelId,
      };
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* §11.1 walkthrough/list                                              */
/* ------------------------------------------------------------------ */

export async function handleWalkthroughList(
  command: Extract<HostCommand, { type: 'walkthrough/list' }>,
  requestId: string | undefined,
  context: WalkthroughCommandContext,
): Promise<HostResponse> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const artifacts = await listWalkthroughs(rootDir, command.sessionId);
  return ok(requestId, 'walkthrough/list', { sessionId: command.sessionId, artifacts });
}

/* ------------------------------------------------------------------ */
/* §11.1 walkthrough/generate                                          */
/* ------------------------------------------------------------------ */

export async function handleWalkthroughGenerate(
  command: Extract<HostCommand, { type: 'walkthrough/generate' }>,
  requestId: string | undefined,
  context: WalkthroughCommandContext,
  registry: WalkthroughGenerationRegistry,
  completionDependencies?: WalkthroughCompletionDependencies,
): Promise<HostResponse> {
  const { sessionId, messageId } = command;
  const rootDir = getPiwinRoot(context.piwinRoot);

  const config = await context.loadConfig();
  const walkthrough = config.walkthrough ?? createDefaultWalkthroughConfig();

  // If a ready artifact already exists and force is not set, return it directly
  // without publishing a new generating state (spec §8.1).
  const existing = await loadWalkthrough(rootDir, sessionId, messageId);
  if (existing && existing.status === 'ready' && !command.force) {
    return ok(requestId, 'walkthrough/generate', {
      sessionId,
      messageId,
      status: 'ready' as const,
      artifact: existing,
    });
  }

  // Concurrency (§11.3): same message max one in-flight generation. If a
  // generation is already running, return its generationId without starting a
  // second request. force only applies when nothing is in-flight.
  const inflight = registry.get(sessionId, messageId);
  if (inflight && !command.force) {
    return ok(requestId, 'walkthrough/generate', {
      sessionId,
      messageId,
      generationId: inflight.generationId,
      status: 'generating' as const,
    });
  }
  if (inflight && command.force) {
    // force only allowed when not generating (§11.2). Since something is
    // in-flight, reject the force attempt.
    return fail(
      requestId,
      'walkthrough/generate',
      JSON.stringify(
        walkthroughError(
          'invalid-config',
          'A generation is already in progress. Cancel it before forcing a new one.',
        ),
      ),
    );
  }

  // Load transcript and validate the target message.
  const messages = await context.loadTranscriptMessages(sessionId);
  const targetMessage = messages.find((m) => m.id === messageId);
  if (!targetMessage) {
    return fail(
      requestId,
      'walkthrough/generate',
      JSON.stringify(walkthroughError('message-not-found', 'The target message was not found.')),
    );
  }

  if (!isWalkthroughEligibleMessage(targetMessage, messages)) {
    return fail(
      requestId,
      'walkthrough/generate',
      JSON.stringify(
        walkthroughError('not-eligible', 'This message is not eligible for a walkthrough.'),
      ),
    );
  }

  // Resolve model + provider + mode.
  const resolved = resolveGenerationModel(command, targetMessage, context, config);
  if (resolved.error) {
    return fail(requestId, 'walkthrough/generate', JSON.stringify(resolved.error));
  }
  const { model, provider, mode } = resolved;
  if (!model || !provider) {
    // Defensive: resolveGenerationModel returns error when missing, but keep
    // a sound fallback so the response is always well-formed.
    return fail(
      requestId,
      'walkthrough/generate',
      JSON.stringify(walkthroughError('model-unavailable', 'No model is available.')),
    );
  }

  // Start a new generation via the shared internal trigger.
  const generationId = await startWalkthroughGeneration(
    sessionId,
    messageId,
    model,
    provider,
    mode,
    walkthrough,
    targetMessage,
    messages,
    context,
    registry,
    completionDependencies,
  );

  return ok(requestId, 'walkthrough/generate', {
    sessionId,
    messageId,
    generationId,
    status: 'generating' as const,
  });
}

/* ------------------------------------------------------------------ */
/* §11.1 Internal generation trigger                                   */
/* ------------------------------------------------------------------ */

/**
 * Internal generation trigger used by both the IPC handler and the
 * auto-walkthrough path. Caller is responsible for validation (enabled,
 * eligibility, concurrency, existing artifact, model resolution).
 *
 * Registers the generation, persists the generating state, pushes the
 * `walkthrough/updated` event, and fires the async completion pipeline.
 * Returns the generationId.
 */
export async function startWalkthroughGeneration(
  sessionId: string,
  messageId: string,
  model: ModelRef,
  provider: ModelProviderConfig,
  mode: WalkthroughMode,
  walkthrough: WalkthroughConfig,
  targetMessage: SessionTranscriptMessage,
  messages: readonly SessionTranscriptMessage[],
  context: WalkthroughCommandContext,
  registry: WalkthroughGenerationRegistry,
  completionDependencies?: WalkthroughCompletionDependencies,
): Promise<string> {
  const rootDir = getPiwinRoot(context.piwinRoot);

  // Start a new generation: register, publish generating, accept immediately.
  const generationId = randomUUID();
  registry.register(sessionId, messageId, generationId);

  const now = new Date().toISOString();
  const generatingArtifact: WalkthroughArtifact = {
    version: 1,
    id: generationId,
    sessionId,
    messageId,
    mode,
    ...(model ? { model } : {}),
    sourceHash: '',
    createdAt: now,
    updatedAt: now,
    status: 'generating',
    generationId,
  };
  if (targetMessage.runId) {
    generatingArtifact.runId = targetMessage.runId;
  }

  // Persist the generating state so a restart can recover it (§7.2).
  await saveWalkthrough(rootDir, sessionId, generatingArtifact);
  context.push({ type: 'walkthrough/updated', sessionId, artifact: generatingArtifact });

  // Fire-and-forget the completion pipeline. The promise is tracked via the
  // registry so cancel can abort it and stale results are discarded (§11.3).
  void runWalkthroughCompletion({
    sessionId,
    messageId,
    generationId,
    model,
    provider,
    mode,
    walkthrough,
    targetMessage,
    messages,
    context,
    registry,
    completionDependencies,
  }).catch((error: unknown) => {
    // Safety net: runWalkthroughCompletion handles its own errors and never
    // rethrows, but a bug in the wiring must not produce a floating promise.
    const detail = error instanceof Error ? error.message : String(error);
    context.push({
      type: 'host/log',
      level: 'error',
      message: `walkthrough generation ${generationId} crashed: ${detail}`,
    });
  });

  return generationId;
}

/* ------------------------------------------------------------------ */
/* Async completion pipeline                                            */
/* ------------------------------------------------------------------ */

type CompletionInput = {
  sessionId: string;
  messageId: string;
  generationId: string;
  model: ModelRef;
  provider: ModelProviderConfig;
  mode: WalkthroughMode;
  walkthrough: WalkthroughConfig;
  targetMessage: SessionTranscriptMessage;
  messages: readonly SessionTranscriptMessage[];
  context: WalkthroughCommandContext;
  registry: WalkthroughGenerationRegistry;
  completionDependencies: WalkthroughCompletionDependencies | undefined;
};

/**
 * Runs the walkthrough completion pipeline asynchronously (spec §11.1).
 *
 * Collects evidence → builds prompts → calls completeWalkthrough → processes
 * output → saves artifact → pushes ready/error. Never throws: all errors are
 * mapped to an error artifact and pushed. Stale generations (superseded by a
 * newer force or cancelled) are discarded (§11.3).
 */
async function runWalkthroughCompletion(input: CompletionInput): Promise<void> {
  const { sessionId, messageId, generationId, context, registry } = input;
  const rootDir = getPiwinRoot(context.piwinRoot);

  try {
    // Reload the plan fresh (evidence collection is read-only, §16.7).
    const plan = await context.loadSessionPlan(sessionId);
    const evidence = collectWalkthroughEvidence(input.messages, messageId, {
      sessionId,
      ...(plan ? { plan } : {}),
    });
    const bounded = redactAndBoundEvidence(evidence);
    const sourceHash = computeSourceHashFromBounded(bounded.bounded);
    const systemPrompt = assembleSystemPrompt();
    const userPrompt = assembleUserPrompt(
      input.mode,
      // When enabled is false, no custom prompt is injected — the model
      // generates freely from system prompt + evidence only (Pi norm).
      input.walkthrough.enabled ? input.walkthrough.custom.prompt : '',
      bounded.bounded,
    );

    const maxOutputTokens = resolveMaxOutputTokens(input.provider, input.model.modelId);
    const result = await completeWalkthrough(
      {
        provider: input.provider,
        modelId: input.model.modelId,
        systemPrompt,
        userPrompt,
        maxOutputTokens,
        temperature: 0.2,
        signal:
          input.registry.get(sessionId, messageId)?.abortController.signal ??
          new AbortController().signal,
      },
      input.completionDependencies,
    );

    // Stale check: if a newer generation started or this was cancelled, drop.
    if (!registry.isCurrent(sessionId, messageId, generationId)) {
      registry.discardStale(sessionId, messageId, generationId);
      return;
    }

    const now = new Date().toISOString();
    const readyArtifact: WalkthroughArtifact = {
      version: 1,
      id: generationId,
      sessionId,
      messageId,
      mode: input.mode,
      model: input.model,
      sourceHash,
      createdAt: now,
      updatedAt: now,
      status: 'ready',
      markdown: result.text,
      ...(bounded.truncated ? { truncated: true } : {}),
      generatedAt: now,
    };
    if (input.targetMessage.runId) {
      readyArtifact.runId = input.targetMessage.runId;
    }

    await saveWalkthrough(rootDir, sessionId, readyArtifact);
    registry.complete(sessionId, messageId, generationId);
    context.push({ type: 'walkthrough/updated', sessionId, artifact: readyArtifact });
  } catch (error) {
    // Stale check before publishing an error: a cancelled generation should
    // not overwrite a newer one.
    if (!registry.isCurrent(sessionId, messageId, generationId)) {
      registry.discardStale(sessionId, messageId, generationId);
      return;
    }
    const walkthroughError = mapCompletionError(error);
    const now = new Date().toISOString();
    const errorArtifact: WalkthroughArtifact = {
      version: 1,
      id: generationId,
      sessionId,
      messageId,
      mode: input.mode,
      ...(input.model ? { model: input.model } : {}),
      sourceHash: '',
      createdAt: now,
      updatedAt: now,
      status: 'error',
      error: walkthroughError,
      generatedAt: now,
    };
    if (input.targetMessage.runId) {
      errorArtifact.runId = input.targetMessage.runId;
    }
    await saveWalkthrough(rootDir, sessionId, errorArtifact);
    registry.complete(sessionId, messageId, generationId);
    context.push({ type: 'walkthrough/updated', sessionId, artifact: errorArtifact });
  }
}

function resolveMaxOutputTokens(provider: ModelProviderConfig, modelId: string): number {
  const model = provider.models.find((m) => m.id === modelId);
  if (model?.maxOutputTokens && model.maxOutputTokens > 0) {
    return model.maxOutputTokens;
  }
  return 4096;
}

function mapCompletionError(error: unknown): WalkthroughError {
  if (error instanceof WalkthroughCompletionError) {
    return walkthroughError(error.code, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return walkthroughError('provider-request-failed', `Walkthrough generation failed: ${message}`);
}

/* ------------------------------------------------------------------ */
/* §11.1 walkthrough/cancel                                            */
/* ------------------------------------------------------------------ */

export async function handleWalkthroughCancel(
  command: Extract<HostCommand, { type: 'walkthrough/cancel' }>,
  requestId: string | undefined,
  context: WalkthroughCommandContext,
  registry: WalkthroughGenerationRegistry,
): Promise<HostResponse> {
  const { sessionId, messageId, generationId } = command;
  const aborted = registry.abort(sessionId, messageId, generationId);
  return ok(requestId, 'walkthrough/cancel', {
    sessionId,
    messageId,
    ...(generationId ? { generationId } : {}),
    status: 'cancelled' as const,
    aborted,
  });
}
