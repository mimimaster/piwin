import { deriveDefaultNameFromMessage } from '@piwin/session/derive-default-name';
import { installMockRendererHarness } from './e2e/mock-renderer-harness.js';
import {
  appendMockTranscriptMessage,
  visibleMockTranscript,
} from './host-client-mock-tree.js';
import { handleMockAuthCommand } from './host-client-mock-auth.js';
import { handleMockLiveCommand, type MockLiveSlot } from './host-client-mock-live.js';
import { MockContextTelemetryStore } from './host-client-mock-context.js';
import { handleMockHostCommands } from './host-client-mock-host.js';
import { handleMockSessionReadCommands } from './host-client-mock-session-read.js';
import { handleMockTurnCommands } from './host-client-mock-turn.js';
import { handleMockSessionLifecycleCommands } from './host-client-mock-lifecycle.js';
import { handleMockWorkspaceCommands } from './host-client-mock-workspace.js';
import { handleMockCatalogCommands } from './host-client-mock-catalog.js';
import { handleMockSettingsCommands } from './host-client-mock-settings.js';
import { handleMockOpsCommands } from './host-client-mock-ops.js';
import { handleMockKnowledgeCommands } from './host-client-mock-knowledge.js';
import { handleMockFlashcardCommands } from './host-client-mock-flashcards.js';
import {
  byteLength,
  chunkText,
  delay,
  mockQueuedInputFingerprint,
  validateMockQueuedTurnInput,
  waitForMockAbort,
  type MockBuiltinThemeId,
} from './host-client-mock-helpers.js';
import type {
  AgentEvent,
  ExecutionRunRecord,
  HostCommand,
  HostMode,
  HostPush,
  HostResponse,
  MediaAttachmentRef,
  ProductSessionLineageView,
  ProductSessionOrigin,
  PromptInput,
  SessionSummary,
  SessionTranscriptMessage,
  ContextSummaryPush,
  RunInterventionRecord,
  QueuedTurnRecord,
} from '@piwin/contracts';
import {
  isRunTerminal,
  QUEUED_TURN_MAX_PENDING_BYTES_PER_SESSION,
  QUEUED_TURN_MAX_PENDING_PER_SESSION,
} from '@piwin/contracts';

export type MockEmit = (message: HostPush) => void;

export class MockHostBackend {
  readonly emitPush: MockEmit;
  readonly getMode: () => HostMode;
  readonly contextTelemetry = new MockContextTelemetryStore();

  sessions = new Map<
    string,
    {
      projectPath: string;
      scope?: import('@piwin/contracts').SessionScope;
      workingDirectory?: string;
      events: AgentEvent[];
      transcript: SessionTranscriptMessage[];
      parentById?: Record<string, string | null>;
      activeLeafMessageId?: string | null;
      name?: string;
      nameSource?: 'default' | 'text' | 'llm' | 'user';
      updatedAt?: string;
      isPinned?: boolean;
      pinnedAt?: string;
      isArchived?: boolean;
      archivedAt?: string;
      origin?: ProductSessionOrigin;
      storage?: import('@piwin/contracts').SessionStorageInfo;
      knowledgeBaseIds?: string[];
    }
  >();
  plans = new Map<string, import('@piwin/contracts').SessionPlan>();
  childIndex = new Map<string, import('@piwin/contracts').SessionSummary[]>();
  /** Mock-only: extension ids disabled via extensions/set_enabled. */
  mockDisabledExtensionIds = new Set<string>();
  mockBundledExtensionsInstalled = true;
  mockDisabledPromptIds = new Set<string>();
  mockActiveThemeId: MockBuiltinThemeId = 'piwin-inkstone';
  mockJobs = new Map<string, import('@piwin/contracts').JobRecord>();
  mockJobLogs = new Map<string, string>();
  mockPtys = new Map<string, { projectPath: string }>();
  mockRememberedPermissions = new Map<
    string,
    Array<{ key: string; action: string; detail: string }>
  >();
  mockProjects = new Map<string, import('@piwin/contracts').ProjectRecord>();
  /** Browser-mode git state used by the composer branch picker. */
  mockGitCurrentBranches = new Map<string, string>();
  mockCronJobs: import('@piwin/contracts').CronJob[] = [];
  mockHooks: import('@piwin/contracts').HookDefinition[] = [];
  mockMcpDocument: import('@piwin/contracts').McpConfigDocument = { mcpServers: {} };
  /** In-flight mock prompt cancellation per session. */
  mockPromptAborts = new Map<string, AbortController>();
  /** In-memory equivalent of the Host's durable active pause checkpoint. */
  mockPauseCheckpointIds = new Map<string, string>();
  mockRunInterventions = new Map<string, RunInterventionRecord>();
  mockQueuedTurns = new Map<string, QueuedTurnRecord[]>();
  mockQueueRevisions = new Map<string, number>();
  mockPauseRequested = new Set<string>();
  /** Mock browser session current URL (null = stopped). */
  mockMediaUploads = new Map<
    string,
    { sessionId: string; mimeType: string; name?: string; byteSize: number }
  >();
  mockBrowserUrl: string | null = null;
  /** ADR 0015: the run currently owning each session's foreground turn. */
  mockActiveRunIds = new Map<string, string>();
  mockAssemblySummaries = new Map<string, ContextSummaryPush[]>();
  mockAssemblyOrdinals = new Map<string, number>();
  /** Guards the exactly-once terminal transition for each mock run. */
  mockTerminalRunIds = new Set<string>();
  mockRuns = new Map<string, ExecutionRunRecord>();
  mockLiveSlot: MockLiveSlot | null = null;
  mockConfig: import('@piwin/contracts').PiwinConfig = {
    hostMode: 'sdk',
    providers: [],
    media: {
      maxPasteBytes: 10 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 100 * 1024,
    },
  };
  /** Monotonic revision for the in-memory settings snapshot (mock parity). */
  mockSettingsRevision = 'mock-settings-v1';
  /** Runtime-only revision kept separate from the full settings CAS token. */
  mockRuntimeSettingsRevision = 'mock-runtime-settings-v1';
  mockUserPermissionRules: import('@piwin/contracts').PermissionRulesFile = { version: 1 };
  mockUserPermissionRulesRevision = 'mock-rules-empty';
  readonly e2eCommandCounts = {
    sessionList: 0,
    sessionListPage: 0,
  };

  constructor(emitPush: MockEmit, getMode: () => HostMode) {
    this.emitPush = emitPush;
    this.getMode = getMode;
    this.installE2eHarness();
  }

  clear(): void {
    this.sessions.clear();
    this.plans.clear();
    this.childIndex.clear();
    this.mockJobs.clear();
    this.mockJobLogs.clear();
    this.mockPtys.clear();
    this.mockRememberedPermissions.clear();
    this.mockGitCurrentBranches.clear();
    this.mockPromptAborts.clear();
    this.mockPauseCheckpointIds.clear();
    this.mockPauseRequested.clear();
    this.mockQueuedTurns.clear();
    this.mockQueueRevisions.clear();
    this.mockActiveRunIds.clear();
    this.mockTerminalRunIds.clear();
    this.contextTelemetry.clear();
  }

  installE2eHarness(): void {
    installMockRendererHarness(this);
  }

  mockSessionSummary(
    sessionId: string,
    session: {
      projectPath: string;
      scope?: import('@piwin/contracts').SessionScope;
      workingDirectory?: string;
      events: AgentEvent[];
      transcript: SessionTranscriptMessage[];
      parentById?: Record<string, string | null>;
      activeLeafMessageId?: string | null;
      name?: string;
      nameSource?: 'default' | 'text' | 'llm' | 'user';
      updatedAt?: string;
      isPinned?: boolean;
      pinnedAt?: string;
      isArchived?: boolean;
      archivedAt?: string;
      origin?: ProductSessionOrigin;
      storage?: import('@piwin/contracts').SessionStorageInfo;
    },
  ): SessionSummary {
    const scope =
      session.scope ??
      (session.projectPath
        ? ({ kind: 'project', projectPath: session.projectPath } as const)
        : ({ kind: 'general' } as const));
    const workingDirectory =
      session.workingDirectory ?? (scope.kind === 'project' ? scope.projectPath : 'general');
    const summary: SessionSummary = {
      id: sessionId,
      scope,
      workingDirectory,
      projectPath: session.projectPath,
      updatedAt: session.updatedAt ?? '1970-01-01T00:00:00.000Z',
      messageCount: visibleMockTranscript(session).length || session.events.length,
      name: session.name ?? `session-${sessionId.slice(0, 8)}`,
    };
    if (session.nameSource) summary.nameSource = session.nameSource;
    if (session.isPinned === true) summary.isPinned = true;
    if (session.pinnedAt) summary.pinnedAt = session.pinnedAt;
    if (session.isArchived === true) summary.isArchived = true;
    if (session.archivedAt) summary.archivedAt = session.archivedAt;
    if (session.origin) summary.origin = session.origin;
    if (session.storage && session.storage.state !== 'local') summary.storage = session.storage;
    return summary;
  }

  mockResolveLineageRoot(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    return session?.origin?.kind === 'fork' ? session.origin.rootSessionId : sessionId;
  }

  mockGetDirectForkNames(sourceSessionId: string): string[] {
    return [...this.sessions.values()]
      .filter(
        (candidate) =>
          candidate.origin?.kind === 'fork' && candidate.origin.sourceSessionId === sourceSessionId,
      )
      .map((candidate) => candidate.name ?? '')
      .filter((name) => name.length > 0);
  }

  mockBuildSessionLineage(sessionId: string): ProductSessionLineageView {
    const targetSession = this.sessions.get(sessionId);
    const rootSessionId =
      targetSession?.origin?.kind === 'fork' ? targetSession.origin.rootSessionId : sessionId;
    const nodes = [...this.sessions.entries()]
      .filter(([candidateId]) => this.mockResolveLineageRoot(candidateId) === rootSessionId)
      .map(([candidateId, candidate]) => ({
        sessionId: candidateId,
        ...(candidate.name ? { name: candidate.name } : {}),
        ...(candidate.origin ? { origin: candidate.origin } : {}),
        isArchived: candidate.isArchived === true,
        updatedAt: new Date().toISOString(),
      }));
    nodes.sort((left, right) => {
      if (left.sessionId === rootSessionId) return -1;
      if (right.sessionId === rootSessionId) return 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
    return {
      rootSessionId,
      activeSessionId: sessionId,
      rootMissing: !this.sessions.has(rootSessionId),
      nodes,
    };
  }

  async handle(command: HostCommand, id: string): Promise<HostResponse> {
    if (command.type === 'session/list') {
      this.e2eCommandCounts.sessionList += 1;
    } else if (command.type === 'session/list-page') {
      this.e2eCommandCounts.sessionListPage += 1;
    }
    const mockAuth = handleMockAuthCommand(this, command, id);
    if (mockAuth) {
      return mockAuth;
    }
    const context = this.contextTelemetry.handleCommand(command, id);
    if (context) {
      return context;
    }
    const dispatched =
      (await handleMockHostCommands(this, command, id)) ??
      (await handleMockSessionReadCommands(this, command, id)) ??
      (await handleMockTurnCommands(this, command, id)) ??
      (await handleMockSessionLifecycleCommands(this, command, id)) ??
      (await handleMockWorkspaceCommands(this, command, id)) ??
      (await handleMockCatalogCommands(this, command, id)) ??
      (await handleMockSettingsCommands(this, command, id)) ??
      (await handleMockOpsCommands(this, command, id)) ??
      (await handleMockKnowledgeCommands(this, command, id)) ??
      (await handleMockFlashcardCommands(this, command, id));
    if (dispatched) {
      return dispatched;
    }
    const live = handleMockLiveCommand({
      command,
      id,
      config: this.mockConfig,
      emitPush: (message) => this.emitPush(message),
      slot: this.mockLiveSlot,
      setSlot: (slot) => {
        this.mockLiveSlot = slot;
      },
    });
    if (live) {
      return live;
    }
    return {
      id,
      type: 'response',
      command: command.type,
      success: false,
      error: `mock client does not implement ${command.type}`,
    };
  }

  mockQueueRevision(sessionId: string): number {
    return this.mockQueueRevisions.get(sessionId) ?? 0;
  }

  bumpMockQueueRevision(sessionId: string): number {
    const next = this.mockQueueRevision(sessionId) + 1;
    this.mockQueueRevisions.set(sessionId, next);
    return next;
  }

  emitMockQueuedTurn(queuedTurn: QueuedTurnRecord): void {
    this.emitPush({ type: 'session/queued-turn-updated', queuedTurn });
  }

  async handleMockQueuedTurnSubmit(
    command: Extract<HostCommand, { type: 'session/queued-turn-submit' }>,
    id: string,
  ): Promise<HostResponse> {
    const session = this.sessions.get(command.sessionId);
    if (!session) {
      return { id, type: 'response', command: command.type, success: false, error: 'unknown session' };
    }
    const existing = this.mockQueuedTurns
      .get(command.sessionId)
      ?.find((item) => item.queuedTurnId === command.queuedTurnId);
    const normalizedInput: PromptInput = {
      ...command.input,
      clientMessageId: command.userMessageId,
    };
    if (existing) {
      if (mockQueuedInputFingerprint(existing.input) !== mockQueuedInputFingerprint(normalizedInput)) {
        return {
          id,
          type: 'response',
          command: command.type,
          success: false,
          error: 'queued-turn-idempotency-conflict',
        };
      }
      return { id, type: 'response', command: command.type, success: true, data: { queuedTurn: existing } };
    }
    const inputError = validateMockQueuedTurnInput(command.input);
    if (inputError) {
      return { id, type: 'response', command: command.type, success: false, error: inputError };
    }
    const queue = this.mockQueuedTurns.get(command.sessionId) ?? [];
    const pending = queue.filter((item) => item.status === 'pending' || item.status === 'starting');
    if (pending.length >= QUEUED_TURN_MAX_PENDING_PER_SESSION) {
      return {
        id,
        type: 'response',
        command: command.type,
        success: false,
        error: 'queued-turn-queue-full',
      };
    }
    const pendingBytes = pending.reduce((total, item) => total + byteLength(item.input.text), 0);
    if (pendingBytes + byteLength(command.input.text) > QUEUED_TURN_MAX_PENDING_BYTES_PER_SESSION) {
      return {
        id,
        type: 'response',
        command: command.type,
        success: false,
        error: 'queued-turn-queue-full',
      };
    }
    const now = new Date().toISOString();
    const queuedTurn: QueuedTurnRecord = {
      queuedTurnId: command.queuedTurnId,
      revision: 1,
      sessionId: command.sessionId,
      sequence: queue.length + 1,
      userMessageId: command.userMessageId,
      mode: 'next',
      status: 'pending',
      input: normalizedInput,
      submittedAt: now,
      updatedAt: now,
    };
    queue.push(queuedTurn);
    this.mockQueuedTurns.set(command.sessionId, queue);
    this.bumpMockQueueRevision(command.sessionId);
    const message: SessionTranscriptMessage = {
      id: queuedTurn.userMessageId,
      role: 'user',
      text: queuedTurn.input.text,
      createdAt: now,
      status: 'done',
      instructionDelivery: {
        kind: 'queued-turn',
        instructionId: queuedTurn.queuedTurnId,
        status: queuedTurn.status,
        revision: queuedTurn.revision,
      },
    };
    if (queuedTurn.input.attachments) {
      const media = queuedTurn.input.attachments.filter(
        (attachment): attachment is MediaAttachmentRef => attachment.kind === 'media',
      );
      if (media.length > 0) message.attachments = media;
    }
    if (queuedTurn.input.contextRefs) message.contextRefs = queuedTurn.input.contextRefs;
    appendMockTranscriptMessage(session, message);
    this.emitPush({ type: 'transcript/append', sessionId: command.sessionId, message });
    this.emitMockQueuedTurn(queuedTurn);
    void this.drainMockQueue(command.sessionId);
    return { id, type: 'response', command: command.type, success: true, data: { queuedTurn } };
  }

  async handleMockQueuedTurnList(
    command: Extract<HostCommand, { type: 'session/queued-turn-list' }>,
    id: string,
  ): Promise<HostResponse> {
    const queuedTurns = [...(this.mockQueuedTurns.get(command.sessionId) ?? [])].sort(
      (left, right) => left.sequence - right.sequence,
    );
    return {
      id,
      type: 'response',
      command: command.type,
      success: true,
      data: { queueRevision: this.mockQueueRevision(command.sessionId), queuedTurns },
    };
  }

  async handleMockQueuedTurnEdit(
    command: Extract<HostCommand, { type: 'session/queued-turn-edit' }>,
    id: string,
  ): Promise<HostResponse> {
    const queue = this.mockQueuedTurns.get(command.sessionId) ?? [];
    const index = queue.findIndex((item) => item.queuedTurnId === command.queuedTurnId);
    const current = queue[index];
    if (!current || current.status !== 'pending' || current.revision !== command.expectedRevision) {
      return { id, type: 'response', command: command.type, success: false, error: 'queued-turn-revision-conflict' };
    }
    const updated: QueuedTurnRecord = {
      ...current,
      revision: current.revision + 1,
      input: { ...command.input, clientMessageId: current.userMessageId },
      updatedAt: new Date().toISOString(),
    };
    queue[index] = updated;
    this.bumpMockQueueRevision(command.sessionId);
    this.updateMockQueuedTranscript(command.sessionId, updated);
    this.emitMockQueuedTurn(updated);
    return { id, type: 'response', command: command.type, success: true, data: { queuedTurn: updated } };
  }

  async handleMockQueuedTurnCancel(
    command: Extract<HostCommand, { type: 'session/queued-turn-cancel' }>,
    id: string,
  ): Promise<HostResponse> {
    const queue = this.mockQueuedTurns.get(command.sessionId) ?? [];
    const index = queue.findIndex((item) => item.queuedTurnId === command.queuedTurnId);
    const current = queue[index];
    if (!current || current.status !== 'pending' || current.revision !== command.expectedRevision) {
      return { id, type: 'response', command: command.type, success: false, error: 'queued-turn-revision-conflict' };
    }
    const cancelled: QueuedTurnRecord = {
      ...current,
      revision: current.revision + 1,
      status: 'cancelled',
      terminalReason: 'user-cancelled',
      updatedAt: new Date().toISOString(),
    };
    queue[index] = cancelled;
    this.bumpMockQueueRevision(command.sessionId);
    this.updateMockQueuedTranscript(command.sessionId, cancelled);
    this.emitMockQueuedTurn(cancelled);
    return { id, type: 'response', command: command.type, success: true, data: { queuedTurn: cancelled } };
  }

  async handleMockQueuedTurnReorder(
    command: Extract<HostCommand, { type: 'session/queued-turn-reorder' }>,
    id: string,
  ): Promise<HostResponse> {
    if (this.mockQueueRevision(command.sessionId) !== command.expectedQueueRevision) {
      return { id, type: 'response', command: command.type, success: false, error: 'queued-turn-revision-conflict' };
    }
    const queue = this.mockQueuedTurns.get(command.sessionId) ?? [];
    const pending = queue.filter((item) => item.status === 'pending');
    if (
      pending.length !== command.orderedQueuedTurnIds.length ||
      new Set(command.orderedQueuedTurnIds).size !== pending.length ||
      command.orderedQueuedTurnIds.some((queuedTurnId) => !pending.some((item) => item.queuedTurnId === queuedTurnId))
    ) {
      return { id, type: 'response', command: command.type, success: false, error: 'queued-turn-reorder-invalid' };
    }
    const firstSequence = queue.reduce(
      (maximum, item) => Math.max(maximum, item.sequence),
      0,
    ) + 1;
    command.orderedQueuedTurnIds.forEach((queuedTurnId, index) => {
      const item = queue.find((candidate) => candidate.queuedTurnId === queuedTurnId);
      if (item) {
        item.sequence = firstSequence + index;
        item.revision += 1;
        this.updateMockQueuedTranscript(command.sessionId, item);
        this.emitMockQueuedTurn(item);
      }
    });
    const revision = this.bumpMockQueueRevision(command.sessionId);
    return { id, type: 'response', command: command.type, success: true, data: { queueRevision: revision, queuedTurns: queue } };
  }

  async handleMockReplaceRun(
    command: Extract<HostCommand, { type: 'session/replace-run' }>,
    id: string,
  ): Promise<HostResponse> {
    const activeRunId = this.mockActiveRunIds.get(command.sessionId);
    if (!activeRunId) {
      return { id, type: 'response', command: command.type, success: false, error: 'queued-turn-no-active-run' };
    }
    if (activeRunId !== command.runId) {
      return { id, type: 'response', command: command.type, success: false, error: 'queued-turn-run-mismatch' };
    }
    const response = await this.handle(
      {
        type: 'session/queued-turn-submit',
        sessionId: command.sessionId,
        queuedTurnId: command.queuedTurnId,
        userMessageId: command.userMessageId,
        input: command.input,
      },
      id,
    );
    if (!response.success) return response;
    const queue = this.mockQueuedTurns.get(command.sessionId) ?? [];
    const item = queue.find((candidate) => candidate.queuedTurnId === command.queuedTurnId);
    if (item) {
      item.mode = 'replace';
      item.replaceRunId = command.runId;
      item.revision += 1;
      this.bumpMockQueueRevision(command.sessionId);
      this.updateMockQueuedTranscript(command.sessionId, item);
      this.emitMockQueuedTurn(item);
    }
    this.pushMockRunUpdated(command.sessionId, command.runId, 'cancelling', 'cancelling');
    this.mockPromptAborts.get(command.sessionId)?.abort();
    return {
      ...response,
      ...(response.success && item
        ? { data: { ...(response.data ?? {}), queuedTurn: item } }
        : {}),
    };
  }

  updateMockQueuedTranscript(sessionId: string, queuedTurn: QueuedTurnRecord): void {
    const session = this.sessions.get(sessionId);
    const message = session?.transcript.find((item) => item.id === queuedTurn.userMessageId);
    if (!message) return;
    message.text = queuedTurn.input.text;
    if (queuedTurn.startedRunId === undefined) {
      delete message.runId;
    } else {
      message.runId = queuedTurn.startedRunId;
    }
    message.instructionDelivery = {
      kind: 'queued-turn',
      instructionId: queuedTurn.queuedTurnId,
      status: queuedTurn.status,
      ...(queuedTurn.startedRunId ?? queuedTurn.replaceRunId
        ? { targetRunId: queuedTurn.startedRunId ?? queuedTurn.replaceRunId }
        : {}),
      revision: queuedTurn.revision,
    };
  }

  async drainMockQueue(sessionId: string): Promise<void> {
    if (this.mockActiveRunIds.has(sessionId)) return;
    const queue = this.mockQueuedTurns.get(sessionId) ?? [];
    const next = [...queue]
      .sort((left, right) => left.sequence - right.sequence)
      .find((item) => item.status === 'pending');
    if (!next) return;
    if (next.mode === 'replace' && next.replaceRunId) {
      const oldRun = this.mockRuns.get(next.replaceRunId);
      if (!oldRun || !isRunTerminal(oldRun.status)) return;
    }
    next.status = 'starting';
    next.revision += 1;
    next.updatedAt = new Date().toISOString();
    this.bumpMockQueueRevision(sessionId);
    this.updateMockQueuedTranscript(sessionId, next);
    this.emitMockQueuedTurn(next);
    const response = await this.handle(
      {
        type: 'session/prompt',
        sessionId,
        admission: 'queued-turn',
        input: { ...next.input, source: 'queued-turn', clientMessageId: next.userMessageId },
      },
      `queued-${next.queuedTurnId}`,
    );
    if (!response.success) {
      next.status = 'failed';
      next.revision += 1;
      next.terminalReason = 'prompt-rejected';
      next.updatedAt = new Date().toISOString();
      this.bumpMockQueueRevision(sessionId);
      this.updateMockQueuedTranscript(sessionId, next);
      this.emitMockQueuedTurn(next);
      return;
    }
    const runId = (response.data as { runId?: unknown } | undefined)?.runId;
    if (typeof runId !== 'string') return;
    next.status = 'started';
    next.startedRunId = runId;
    next.revision += 1;
    next.updatedAt = new Date().toISOString();
    this.bumpMockQueueRevision(sessionId);
    this.updateMockQueuedTranscript(sessionId, next);
    this.emitMockQueuedTurn(next);
  }

  async emitMockPrompt(sessionId: string, text: string, runId: string): Promise<void> {
    const existing = this.mockPromptAborts.get(sessionId);
    existing?.abort();
    const controller = new AbortController();
    this.mockPromptAborts.set(sessionId, controller);

    const assistantId = crypto.randomUUID();
    const toolId = crypto.randomUUID();
    const session = this.sessions.get(sessionId);
    const isRendererStressPrompt = text.includes('__PIWIN_RENDER_STRESS__');
    if (isRendererStressPrompt && session) {
      for (let historyIndex = 0; historyIndex < 500; historyIndex += 1) {
        const historyMessage: SessionTranscriptMessage = {
          id: crypto.randomUUID(),
          role: historyIndex % 2 === 0 ? 'user' : 'assistant',
          text: `renderer stress history message ${historyIndex}`,
          createdAt: new Date().toISOString(),
          status: 'done',
        };
        appendMockTranscriptMessage(session, historyMessage);
        this.emitPush({
          type: 'transcript/append',
          sessionId,
          message: historyMessage,
        });
      }
    }
    const wantsAbortWindow =
      !isRendererStressPrompt &&
      (/abort|mid way|fairly long reply/i.test(text) || text.length > 120);
    const reply = isRendererStressPrompt
      ? `renderer stress stream\n${'x'.repeat(100_000)}`
      : wantsAbortWindow
        ? `piwin desktop mock reply.\nYou said: ${text}\n${'chunk '.repeat(80)}`
        : `piwin desktop mock reply.\nYou said: ${text}`;
    this.pushMockRunUpdated(sessionId, runId, 'running', 'waiting-first-token');
    this.pushEvent(sessionId, {
      type: 'message/start',
      messageId: assistantId,
      role: 'assistant',
      runId,
    });
    this.pushEvent(sessionId, {
      type: 'tool/start',
      toolCallId: toolId,
      toolName: 'mock_echo',
      runId,
    });
    this.pushEvent(sessionId, { type: 'tool/end', toolCallId: toolId, isError: false, runId });
    this.pushMockRunUpdated(sessionId, runId, 'running', 'streaming');

    let assembled = '';
    try {
      for (const chunk of chunkText(reply, 28)) {
        if (controller.signal.aborted) {
          if (session) {
            appendMockTranscriptMessage(session, {
              id: assistantId,
              role: 'assistant',
              text: assembled,
              createdAt: new Date().toISOString(),
              status: 'done',
            });
          }
          this.pushEvent(sessionId, {
            type: 'session/aborted',
            sessionId,
            messageId: assistantId,
            runId,
          });
          const paused = this.mockPauseRequested.delete(sessionId);
          this.emitMockTerminal(
            sessionId,
            runId,
            paused ? 'interrupted' : 'cancelled',
            paused ? 'paused' : 'cancelled',
            paused ? this.mockPauseCheckpointIds.get(sessionId) : undefined,
          );
          return;
        }
        assembled += chunk;
        this.pushEvent(sessionId, {
          type: 'message/text_delta',
          messageId: assistantId,
          delta: chunk,
          runId,
        });
        // Keep the renderer stress fixture in streaming state until Stop is
        // pressed. This makes the cancellation test independent of timer
        // speed and prevents a natural completion from racing the click.
        if (isRendererStressPrompt && assembled.length === chunk.length) {
          await waitForMockAbort(controller.signal);
        }
        await delay(isRendererStressPrompt ? 1 : wantsAbortWindow ? 35 : 12);
      }

      if (controller.signal.aborted) {
        if (session) {
          appendMockTranscriptMessage(session, {
            id: assistantId,
            role: 'assistant',
            text: assembled,
            createdAt: new Date().toISOString(),
            status: 'done',
          });
        }
        this.pushEvent(sessionId, {
          type: 'session/aborted',
          sessionId,
          messageId: assistantId,
          runId,
        });
        const paused = this.mockPauseRequested.delete(sessionId);
        this.emitMockTerminal(
          sessionId,
          runId,
          paused ? 'interrupted' : 'cancelled',
          paused ? 'paused' : 'cancelled',
          paused ? this.mockPauseCheckpointIds.get(sessionId) : undefined,
        );
        return;
      }

      if (session) {
        appendMockTranscriptMessage(session, {
          id: assistantId,
          role: 'assistant',
          text: reply,
          createdAt: new Date().toISOString(),
          status: 'done',
        });
      }
      this.pushEvent(sessionId, { type: 'message/end', messageId: assistantId, runId });
      this.contextTelemetry.noteAssistantReply({
        sessionId,
        messageId: assistantId,
        runId,
        emitPush: (message) => this.emitPush(message),
      });
      this.emitMockTerminal(sessionId, runId, 'completed');
      // Mirror host auto-naming: name after the first completed exchange unless
      // the user has manually renamed the session.
      this.maybeMockAutoName(sessionId);
    } finally {
      if (this.mockPromptAborts.get(sessionId) === controller) {
        this.mockPromptAborts.delete(sessionId);
      }
    }
  }

  emitMockTerminal(
    sessionId: string,
    runId: string,
    outcome: 'completed' | 'cancelled' | 'failed' | 'interrupted',
    code?: 'cancelled' | 'paused',
    resumeCheckpointId?: string,
  ): void {
    if (this.mockTerminalRunIds.has(runId)) {
      return;
    }
    this.mockTerminalRunIds.add(runId);
    if (this.mockActiveRunIds.get(sessionId) === runId) {
      this.mockActiveRunIds.delete(sessionId);
    }
    const existing = this.mockRuns.get(runId);
    const terminalRun: ExecutionRunRecord = {
      ...(existing ?? {
        runId,
        kind: 'session-turn' as const,
        rootRunId: runId,
        sessionId,
      }),
      status: outcome,
      endedAt: new Date().toISOString(),
      ...(code ? { terminalCode: code } : {}),
      ...(resumeCheckpointId ? { resumeCheckpointId } : {}),
    };
    this.mockRuns.set(runId, terminalRun);
    if (
      outcome === 'completed' ||
      (outcome === 'cancelled' && (resumeCheckpointId ?? existing?.resumeCheckpointId))
    ) {
      this.mockPauseCheckpointIds.delete(sessionId);
    }
    this.emitPush({ type: 'run/updated', run: terminalRun });
    this.emitPush({ type: 'run/terminal', run: terminalRun });
    // Preserve the Host terminal barrier: only request the next-turn drain
    // after the terminal projection has entered the client stream.
    void this.drainMockQueue(sessionId);
  }

  pushMockRunUpdated(
    sessionId: string,
    runId: string,
    status: ExecutionRunRecord['status'],
    phase: import('@piwin/contracts').SessionRunPhase,
    at = new Date().toISOString(),
    resumeCheckpointId?: string,
  ): void {
    const existing = this.mockRuns.get(runId);
    const run: ExecutionRunRecord = {
      ...(existing ?? {
        runId,
        kind: 'session-turn' as const,
        rootRunId: runId,
        sessionId,
        firstTokenReceived: false,
      }),
      status,
      phase,
      phaseUpdatedAt: at,
      ...(resumeCheckpointId ? { resumeCheckpointId } : {}),
      ...(existing?.startedAt ? {} : { startedAt: at }),
    };
    this.mockRuns.set(runId, run);
    this.emitPush({ type: 'run/updated', run });
  }

  /**
   * Mock-only auto-naming so browser e2e sees the same `session/name-updated`
   * push as the real host. Names only default/auto sessions, never user-set.
   */
  maybeMockAutoName(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    // Terminal sources; also skip if we already wrote a text name.
    if (
      session.nameSource === 'user' ||
      session.nameSource === 'llm' ||
      session.nameSource === 'text'
    ) {
      return;
    }
    const firstUser = session.transcript.find((message) => message.role === 'user');
    const name = firstUser?.text ? deriveDefaultNameFromMessage(firstUser.text) : '';
    if (!name) {
      return;
    }
    session.name = name;
    session.nameSource = 'text';
    this.emitPush({
      type: 'session/name-updated',
      sessionId,
      name,
      nameSource: 'text',
    });
  }

  pushEvent(sessionId: string, event: AgentEvent): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.events.push(event);
    }
    this.emitPush({ type: 'event', sessionId, event });
  }
}
