import { createHash } from 'node:crypto';
import type {
  ExecutionRunRecord,
  HostCommand,
  HostPush,
  HostResponse,
  PromptInput,
  QueuedTurnRecord,
} from '@piwin/contracts';
import {
  isRunTerminal,
  isQueuedTurnPending,
  QUEUED_TURN_MAX_TEXT_BYTES,
} from '@piwin/contracts';
import type { SessionTranscriptStore } from '@piwin/session';
import { fail, ok } from './response-helpers.js';

type QueuedCommand = Extract<
  HostCommand,
  {
    type:
      | 'session/queued-turn-submit'
      | 'session/queued-turn-list'
      | 'session/queued-turn-edit'
      | 'session/queued-turn-cancel'
      | 'session/queued-turn-reorder'
      | 'session/replace-run';
  }
>;

export type QueuedTurnControllerOptions = {
  getTranscriptStore: (sessionId: string) => Promise<SessionTranscriptStore>;
  hasSession: (sessionId: string) => Promise<boolean>;
  getForegroundRun: (sessionId: string) => ExecutionRunRecord | undefined;
  getRun: (runId: string) => ExecutionRunRecord | undefined;
  requestCancelRun: (sessionId: string, runId: string) => ExecutionRunRecord | undefined;
  updateRunPhase: (runId: string, phase: 'cancelling', detail?: string) => void;
  settlePendingPermissions: (sessionId: string) => void;
  settlePendingExtensionUi: (sessionId: string) => void;
  validatePromptAttachments: (input: PromptInput) => void;
  admitPrompt: (
    command: Extract<HostCommand, { type: 'session/prompt' }>,
  ) => Promise<HostResponse>;
  push: (message: HostPush) => void;
  replacementCancellationTimeoutMs?: number;
};

const QUEUED_ID_MAX_LENGTH = 256;
const REPLACEMENT_TIMEOUT_MS = 30_000;

/** Host authority for durable next-turn and Replace Run workflows. */
export class QueuedTurnController {
  private readonly options: QueuedTurnControllerOptions;
  private readonly drainPromises = new Map<string, Promise<void>>();
  private readonly reconciledSessions = new Set<string>();
  private readonly terminalRunIds = new Set<string>();
  private readonly replacementTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: QueuedTurnControllerOptions) {
    this.options = options;
  }

  async handleCommand(
    command: HostCommand,
    requestId: string | undefined,
  ): Promise<HostResponse | null> {
    if (!isQueuedCommand(command)) return null;
    if (!(await this.options.hasSession(command.sessionId))) {
      return fail(requestId, command.type, `Unknown session: ${command.sessionId}`);
    }
    const store = await this.options.getTranscriptStore(command.sessionId);
    await this.reconcile(command.sessionId, store);
    switch (command.type) {
      case 'session/queued-turn-submit':
        return this.submitNext(command, requestId, store);
      case 'session/queued-turn-list':
        return this.list(command, requestId, store);
      case 'session/queued-turn-edit':
        return this.edit(command, requestId, store);
      case 'session/queued-turn-cancel':
        return this.cancel(command, requestId, store);
      case 'session/queued-turn-reorder':
        return this.reorder(command, requestId, store);
      case 'session/replace-run':
        return this.replace(command, requestId, store);
    }
  }

  /** Called by RunRegistry after the terminal push has entered the egress path. */
  notifyRunTerminal(run: ExecutionRunRecord): void {
    this.terminalRunIds.add(run.runId);
    const timer = this.replacementTimers.get(run.runId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.replacementTimers.delete(run.runId);
    }
    queueMicrotask(() => {
      void this.drainSafely(run.sessionId);
    });
  }

  requestDrain(sessionId: string): void {
    queueMicrotask(() => {
      void this.drainSafely(sessionId);
    });
  }

  dispose(): void {
    for (const timer of this.replacementTimers.values()) clearTimeout(timer);
    this.replacementTimers.clear();
  }

  private async reconcile(sessionId: string, store: SessionTranscriptStore): Promise<void> {
    if (this.reconciledSessions.has(sessionId)) return;
    this.reconciledSessions.add(sessionId);
    const updated = await store.reconcileQueuedTurns(new Date().toISOString());
    for (const queuedTurn of updated) this.options.push({ type: 'session/queued-turn-updated', queuedTurn });
    // A normal pending turn is safe to resume after Host restart. Replace
    // records remain gated by their exact target run and therefore stop in
    // `isReplacementSettled` until a terminal observation exists.
    this.requestDrain(sessionId);
  }

  private async submitNext(
    command: Extract<HostCommand, { type: 'session/queued-turn-submit' }>,
    requestId: string | undefined,
    store: SessionTranscriptStore,
  ): Promise<HostResponse> {
    const inputError = this.validateInput(command.input);
    if (inputError) return fail(requestId, command.type, inputError);
    const normalized = normalizeInput(command.input, command.userMessageId);
    const identityError = validateIdentity(command.queuedTurnId, command.userMessageId);
    if (identityError) return fail(requestId, command.type, identityError);
    let result;
    try {
      result = await store.createQueuedTurn({
        queuedTurnId: command.queuedTurnId,
        sessionId: command.sessionId,
        userMessageId: command.userMessageId,
        mode: 'next',
        input: normalized,
        fingerprint: queuedTurnFingerprint({
          sessionId: command.sessionId,
          queuedTurnId: command.queuedTurnId,
          userMessageId: command.userMessageId,
          mode: 'next',
          input: normalized,
        }),
        submittedAt: new Date().toISOString(),
      });
    } catch (error) {
      return fail(requestId, command.type, `queued-turn-admission-failed: ${formatError(error)}`);
    }
    if (!('queuedTurn' in result)) {
      return fail(requestId, command.type, `queued-turn-${result.outcome}`);
    }
    await this.publishCreated(store, result.queuedTurn);
    this.requestDrain(command.sessionId);
    return ok(requestId, command.type, { queuedTurn: result.queuedTurn });
  }

  private async list(
    command: Extract<HostCommand, { type: 'session/queued-turn-list' }>,
    requestId: string | undefined,
    store: SessionTranscriptStore,
  ): Promise<HostResponse> {
    const result = await store.listQueuedTurns();
    return ok(requestId, command.type, result);
  }

  private async edit(
    command: Extract<HostCommand, { type: 'session/queued-turn-edit' }>,
    requestId: string | undefined,
    store: SessionTranscriptStore,
  ): Promise<HostResponse> {
    const inputError = this.validateInput(command.input);
    if (inputError) return fail(requestId, command.type, inputError);
    const existing = await store.getQueuedTurn(command.queuedTurnId);
    if (!existing) return fail(requestId, command.type, 'queued-turn-not-found');
    const normalized = normalizeInput(command.input, existing.userMessageId);
    const updated = await store.updatePendingQueuedTurn({
      queuedTurnId: existing.queuedTurnId,
      expectedRevision: command.expectedRevision,
      input: normalized,
      fingerprint: queuedTurnFingerprint({
        sessionId: existing.sessionId,
        queuedTurnId: existing.queuedTurnId,
        userMessageId: existing.userMessageId,
        mode: existing.mode,
        ...(existing.replaceRunId === undefined ? {} : { replaceRunId: existing.replaceRunId }),
        input: normalized,
      }),
      updatedAt: new Date().toISOString(),
    });
    if (updated === undefined) return fail(requestId, command.type, 'queued-turn-revision-conflict');
    if ('outcome' in updated) {
      return fail(
        requestId,
        command.type,
        updated.outcome === 'bounds-exceeded'
          ? 'queued-turn-bounds-exceeded: text exceeds 64 KiB'
          : 'queued-turn-queue-full',
      );
    }
    this.options.push({ type: 'session/queued-turn-updated', queuedTurn: updated });
    return ok(requestId, command.type, { queuedTurn: updated });
  }

  private async cancel(
    command: Extract<HostCommand, { type: 'session/queued-turn-cancel' }>,
    requestId: string | undefined,
    store: SessionTranscriptStore,
  ): Promise<HostResponse> {
    const existing = await store.getQueuedTurn(command.queuedTurnId);
    if (!existing) return fail(requestId, command.type, 'queued-turn-not-found');
    const cancelled = await store.transitionQueuedTurn({
      queuedTurnId: existing.queuedTurnId,
      expectedRevision: command.expectedRevision,
      from: ['pending'],
      to: 'cancelled',
      updatedAt: new Date().toISOString(),
      terminalReason: 'user-cancelled',
    });
    if (!cancelled) return fail(requestId, command.type, 'queued-turn-revision-conflict');
    this.options.push({ type: 'session/queued-turn-updated', queuedTurn: cancelled });
    return ok(requestId, command.type, { queuedTurn: cancelled });
  }

  private async reorder(
    command: Extract<HostCommand, { type: 'session/queued-turn-reorder' }>,
    requestId: string | undefined,
    store: SessionTranscriptStore,
  ): Promise<HostResponse> {
    if (
      !Number.isSafeInteger(command.expectedQueueRevision) ||
      command.expectedQueueRevision < 0 ||
      command.orderedQueuedTurnIds.some((id) => id.length === 0 || id.length > QUEUED_ID_MAX_LENGTH)
    ) {
      return fail(requestId, command.type, 'queued-turn-reorder-invalid');
    }
    const result = await store.reorderQueuedTurns({
      expectedQueueRevision: command.expectedQueueRevision,
      orderedQueuedTurnIds: command.orderedQueuedTurnIds,
    });
    if (!result) return fail(requestId, command.type, 'queued-turn-revision-conflict');
    for (const queuedTurn of result.queuedTurns) {
      if (isQueuedTurnPending(queuedTurn.status)) {
        this.options.push({ type: 'session/queued-turn-updated', queuedTurn });
      }
    }
    return ok(requestId, command.type, result);
  }

  private async replace(
    command: Extract<HostCommand, { type: 'session/replace-run' }>,
    requestId: string | undefined,
    store: SessionTranscriptStore,
  ): Promise<HostResponse> {
    const inputError = this.validateInput(command.input);
    if (inputError) return fail(requestId, command.type, inputError);
    const identityError = validateIdentity(command.queuedTurnId, command.userMessageId);
    if (identityError) return fail(requestId, command.type, identityError);
    const normalized = normalizeInput(command.input, command.userMessageId);
    // Check for an existing record before requiring a foreground Run. A
    // request retry can arrive after the original replacement has already
    // cancelled its target; idempotency must replay the durable admission
    // rather than turning that retry into a misleading "no active run" error.
    const existing = await store.getQueuedTurn(command.queuedTurnId);
    if (existing !== undefined) {
      const replay = await store.createQueuedTurn({
        queuedTurnId: command.queuedTurnId,
        sessionId: command.sessionId,
        userMessageId: command.userMessageId,
        mode: 'replace',
        replaceRunId: command.runId,
        input: normalized,
        fingerprint: queuedTurnFingerprint({
          sessionId: command.sessionId,
          queuedTurnId: command.queuedTurnId,
          userMessageId: command.userMessageId,
          mode: 'replace',
          replaceRunId: command.runId,
          input: normalized,
        }),
        submittedAt: existing.submittedAt,
      });
      if ('queuedTurn' in replay) {
        return ok(requestId, command.type, { queuedTurn: replay.queuedTurn });
      }
      return fail(requestId, command.type, `queued-turn-${replay.outcome}`);
    }
    const active = this.options.getForegroundRun(command.sessionId);
    if (!active) return fail(requestId, command.type, 'queued-turn-no-active-run');
    if (active.runId !== command.runId) {
      return fail(requestId, command.type, 'queued-turn-run-mismatch');
    }
    if (active.status === 'cancelling' || active.phase === 'pausing') {
      return fail(requestId, command.type, 'queued-turn-replace-ineligible');
    }
    const result = await store.createQueuedTurn({
      queuedTurnId: command.queuedTurnId,
      sessionId: command.sessionId,
      userMessageId: command.userMessageId,
      mode: 'replace',
      replaceRunId: command.runId,
      input: normalized,
      fingerprint: queuedTurnFingerprint({
        sessionId: command.sessionId,
        queuedTurnId: command.queuedTurnId,
        userMessageId: command.userMessageId,
        mode: 'replace',
        replaceRunId: command.runId,
        input: normalized,
      }),
      submittedAt: new Date().toISOString(),
    });
    if (!('queuedTurn' in result)) {
      return fail(requestId, command.type, `queued-turn-${result.outcome}`);
    }
    let queuedTurn = result.queuedTurn;
    await this.publishCreated(store, queuedTurn);
    this.options.updateRunPhase(active.runId, 'cancelling', 'Replaced by a newer user message');
    const requested = this.options.requestCancelRun(command.sessionId, active.runId);
    if (!requested) {
      const failed = await store.transitionQueuedTurn({
        queuedTurnId: queuedTurn.queuedTurnId,
        expectedRevision: queuedTurn.revision,
        from: ['pending'],
        to: 'failed',
        updatedAt: new Date().toISOString(),
        terminalReason: 'replacement-target-mismatch',
      });
      if (failed) {
        queuedTurn = failed;
        this.options.push({ type: 'session/queued-turn-updated', queuedTurn });
      }
      return ok(requestId, command.type, { queuedTurn });
    }
    this.options.settlePendingPermissions(command.sessionId);
    this.options.settlePendingExtensionUi(command.sessionId);
    const timeoutMs = this.options.replacementCancellationTimeoutMs ?? REPLACEMENT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      void this.failTimedOutReplacement(command.sessionId, command.runId, command.queuedTurnId);
    }, timeoutMs);
    timer.unref?.();
    this.replacementTimers.set(command.runId, timer);
    this.requestDrain(command.sessionId);
    return ok(requestId, command.type, { queuedTurn });
  }

  private async failTimedOutReplacement(
    sessionId: string,
    runId: string,
    queuedTurnId: string,
  ): Promise<void> {
    const store = await this.options.getTranscriptStore(sessionId);
    const current = await store.getQueuedTurn(queuedTurnId);
    if (!current || current.status !== 'pending' || current.replaceRunId !== runId) return;
    const failed = await store.transitionQueuedTurn({
      queuedTurnId,
      expectedRevision: current.revision,
      from: ['pending'],
      to: 'failed',
      updatedAt: new Date().toISOString(),
      terminalReason: 'replacement-cancellation-timeout',
    });
    if (failed) this.options.push({ type: 'session/queued-turn-updated', queuedTurn: failed });
  }

  private async publishCreated(
    store: SessionTranscriptStore,
    queuedTurn: QueuedTurnRecord,
  ): Promise<void> {
    const message = await store.getMessage(queuedTurn.userMessageId);
    if (message) {
      this.options.push({ type: 'transcript/append', sessionId: queuedTurn.sessionId, message });
    }
    this.options.push({ type: 'session/queued-turn-updated', queuedTurn });
  }

  private async drain(sessionId: string): Promise<void> {
    const existing = this.drainPromises.get(sessionId);
    if (existing) return existing;
    const operation = this.runDrain(sessionId);
    this.drainPromises.set(sessionId, operation);
    try {
      await operation;
    } finally {
      if (this.drainPromises.get(sessionId) === operation) this.drainPromises.delete(sessionId);
    }
  }

  private async drainSafely(sessionId: string): Promise<void> {
    try {
      await this.drain(sessionId);
    } catch (error) {
      // A terminal callback can outlive a short-lived or synthetic session
      // (for example a memory-pressure fixture). Never leak that cleanup
      // failure as an unhandled rejection; retain an operator-visible record
      // while allowing the run terminal state to stand.
      this.options.push({
        type: 'host/log',
        level: 'warn',
        message: `queued-turn drain failed for ${sessionId}: ${formatError(error)}`,
      });
    }
  }

  private async runDrain(sessionId: string): Promise<void> {
    const store = await this.options.getTranscriptStore(sessionId);
    for (;;) {
      if (this.options.getForegroundRun(sessionId)) return;
      const result = await store.listQueuedTurns();
      const next = result.queuedTurns.find((candidate) => candidate.status === 'pending');
      if (!next) return;
      if (next.mode === 'replace' && !this.isReplacementSettled(next)) return;
      const starting = await store.transitionQueuedTurn({
        queuedTurnId: next.queuedTurnId,
        expectedRevision: next.revision,
        from: ['pending'],
        to: 'starting',
        updatedAt: new Date().toISOString(),
      });
      if (!starting) continue;
      this.options.push({ type: 'session/queued-turn-updated', queuedTurn: starting });
      try {
        this.options.validatePromptAttachments(starting.input);
      } catch {
        await this.failStarting(store, starting, 'media-unavailable');
        continue;
      }
      const response = await this.options.admitPrompt({
        type: 'session/prompt',
        sessionId,
        admission: 'queued-turn',
        input: {
          ...starting.input,
          source: 'queued-turn',
          clientMessageId: starting.userMessageId,
        },
      });
      if (!response.success) {
        if (response.error.includes('run-active:')) {
          const pending = await store.transitionQueuedTurn({
            queuedTurnId: starting.queuedTurnId,
            expectedRevision: starting.revision,
            from: ['starting'],
            to: 'pending',
            updatedAt: new Date().toISOString(),
          });
          if (pending) this.options.push({ type: 'session/queued-turn-updated', queuedTurn: pending });
          return;
        }
        await this.failStarting(store, starting, 'prompt-rejected');
        continue;
      }
      const data = response.data as { runId?: unknown } | undefined;
      if (typeof data?.runId !== 'string' || data.runId.length === 0) {
        await this.failStarting(store, starting, 'preparation-failed');
        continue;
      }
      const started = await store.transitionQueuedTurn({
        queuedTurnId: starting.queuedTurnId,
        expectedRevision: starting.revision,
        from: ['starting'],
        to: 'started',
        updatedAt: new Date().toISOString(),
        startedRunId: data.runId,
      });
      if (started) this.options.push({ type: 'session/queued-turn-updated', queuedTurn: started });
      return;
    }
  }

  private isReplacementSettled(queuedTurn: QueuedTurnRecord): boolean {
    const target = queuedTurn.replaceRunId;
    if (!target) return true;
    if (this.terminalRunIds.has(target)) return true;
    const run = this.options.getRun(target);
    if (!run) return false;
    return isRunTerminal(run.status);
  }

  private async failStarting(
    store: SessionTranscriptStore,
    starting: QueuedTurnRecord,
    reason: 'media-unavailable' | 'prompt-rejected' | 'preparation-failed',
  ): Promise<void> {
    const failed = await store.transitionQueuedTurn({
      queuedTurnId: starting.queuedTurnId,
      expectedRevision: starting.revision,
      from: ['starting'],
      to: 'failed',
      updatedAt: new Date().toISOString(),
      terminalReason: reason,
    });
    if (failed) this.options.push({ type: 'session/queued-turn-updated', queuedTurn: failed });
  }

  private validateInput(input: PromptInput): string | undefined {
    if (
      input.text.trim().length === 0 &&
      (input.attachments?.length ?? 0) === 0 &&
      (input.contextRefs?.length ?? 0) === 0
    ) {
      return 'queued-turn-empty: text, attachment, or context is required';
    }
    if (Buffer.byteLength(input.text, 'utf8') > QUEUED_TURN_MAX_TEXT_BYTES) {
      return 'queued-turn-bounds-exceeded: text exceeds 64 KiB';
    }
    if (input.source === 'resume' || input.resumeCheckpointId !== undefined) {
      return 'queued-turn-input-invalid: resume prompts cannot be queued';
    }
    try {
      this.options.validatePromptAttachments(input);
    } catch (error) {
      return `queued-turn-input-invalid: ${formatError(error)}`;
    }
    return undefined;
  }
}

function isQueuedCommand(command: HostCommand): command is QueuedCommand {
  return (
    command.type === 'session/queued-turn-submit' ||
    command.type === 'session/queued-turn-list' ||
    command.type === 'session/queued-turn-edit' ||
    command.type === 'session/queued-turn-cancel' ||
    command.type === 'session/queued-turn-reorder' ||
    command.type === 'session/replace-run'
  );
}

function validateIdentity(queuedTurnId: string, userMessageId: string): string | undefined {
  if (
    queuedTurnId.trim().length === 0 ||
    userMessageId.trim().length === 0 ||
    queuedTurnId.length > QUEUED_ID_MAX_LENGTH ||
    userMessageId.length > QUEUED_ID_MAX_LENGTH
  ) {
    return 'queued-turn-identity-invalid';
  }
  return undefined;
}

function normalizeInput(input: PromptInput, userMessageId: string): PromptInput {
  const { source: _source, resumeCheckpointId: _checkpoint, ...rest } = input;
  return { ...rest, clientMessageId: userMessageId };
}

function queuedTurnFingerprint(input: {
  sessionId: string;
  queuedTurnId: string;
  userMessageId: string;
  mode: 'next' | 'replace';
  replaceRunId?: string;
  input: PromptInput;
}): string {
  const canonical = canonicalize({
    sessionId: input.sessionId,
    queuedTurnId: input.queuedTurnId,
    userMessageId: input.userMessageId,
    mode: input.mode,
    ...(input.replaceRunId === undefined ? {} : { replaceRunId: input.replaceRunId }),
    input: input.input,
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
