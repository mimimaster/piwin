import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import type {
  AgentEvent,
  AgentHost,
  CreateSessionInput,
  HostCommand,
  HostMode,
  HostPush,
  HostResponse,
  HostStatusData,
  MediaAttachmentRef,
  MediaSaveData,
  PermissionDecision,
  PromptInput,
  SessionHandle,
} from '@piwin/contracts';
import { formatTextModelImageInjection } from '@piwin/contracts';
import { assertInsideMediaRoot, createMediaService } from '@piwin/media';
import { ensureBundledSkillsInstalled, scanSkills } from '@piwin/skills';
import { installSkill, installExtension } from '@piwin/marketplace';
import { scanExtensions } from './extension-scanner.js';
import { ensureBundledExtensionsInstalled } from './ensure-bundled-extensions.js';
import { scanPrompts } from './prompt-scanner.js';
import { ensureBundledPromptsInstalled } from './ensure-bundled-prompts.js';
import {
  createMcpLifecycleManager,
  getMcpConfigPath,
  loadMcpConfig,
  saveMcpConfig,
  tryValidateMcpConfig,
  type McpLifecycleManager,
} from '@piwin/mcp';
import { createProcessRegistry, type ProcessRegistry } from '@piwin/process';
import { createMemoryStore, projectKeyFromPath } from '@piwin/memory';
import type { MemoryStore } from '@piwin/memory';
import {
  buildMemoryOverviewInjection,
  prependMemoryOverview,
  shouldInjectMemoryOverview,
} from './memory-inject.js';
import { createGitService } from '@piwin/git';
import {
  getActiveTheme,
  installThemeFromLocalPath,
  listThemes,
  setActiveTheme,
} from '@piwin/theme';
import {
  getActivePet,
  importPetsFromCodex,
  installPetFromLocalPath,
  listPets,
  setActivePet,
} from '@piwin/pet';
import {
  allowNetworkFetchHost,
  allowNetworkWebSearch,
  allowMcpServer,
  listProjects,
  openOrCreateProject,
  setProjectTrust,
} from '@piwin/project';

import {
  createSessionRecord,
  getSessionRecord,
  listSessionsForProject,
  listTranscriptMessages,
  upsertSessionRecord,
  buildSessionOutline,
  loadSessionPlan,
  saveSessionPlan,
  clearSessionPlan,
  validateSessionPlan,
  listChildSessions,
  appendTranscriptMessage,
  buildSubagentMergeSummary,
  formatSubagentMergeCard,
  applyPlanStepUpdate,
  applyPlanStatus,
  pinSessionRecord,
  unpinSessionRecord,
  searchSessions,
  truncateTranscriptFrom,
  buildProductHistoryContext,
  mergeProductHistoryIntoPrompt,
  exportTranscript,
  suggestSessionExportBasename,
} from '@piwin/session';
import type {
  ContextUsageSnapshot,
  ExecutionMode,
  SessionResumeData,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { estimateMockUsage } from './usage-map.js';
import { createTranscriptRecorder } from './transcript-recorder.js';
import { createProductShellSession } from './product-shell-session.js';
import { formatPlanForModelContext } from './format-plan-context.js';
import { createAgentHost } from './create-host.js';
import { loadPiwinConfig, savePiwinConfig } from './config-store.js';
import {
  getPiwinMediaDir,
  getPiwinProjectsPath,
  getPiwinRoot,
  getPiwinSessionIndexPath,
  getPiwinSessionTranscriptPath,
  getPiwinSessionPlanPath,
  getPiwinSessionDir,
} from './paths.js';

export type HostRuntimeOptions = {
  mode: HostMode;
  mock?: boolean;
  piwinRoot?: string;
  rpcCommand?: string;
  onPush?: (message: HostPush) => void;
};

export class HostRuntime {
  private readonly host: AgentHost;
  private readonly sessions = new Map<string, SessionHandle>();
  private readonly sessionProjects = new Map<string, string>();
  /** CE-MODE: per-session execution mode (chat strips tools). */
  private readonly sessionExecutionModes = new Map<string, ExecutionMode>();
  /** CE-OBS: last known usage snapshot per session. */
  private readonly sessionUsage = new Map<string, ContextUsageSnapshot>();
  /** Last user prompt text for host-estimate usage (mock path). */
  private readonly sessionLastPromptText = new Map<string, string>();
  /** Runtime-only session override for auto-compaction (not persisted). */
  private readonly sessionAutoCompactionOverrides = new Map<string, boolean>();
  /** Serialize merge-subagent per parent session. */
  private readonly mergeLocks = new Map<string, Promise<unknown>>();
  private readonly unsubscribers = new Map<string, () => void>();
  private readonly pendingPermissions = new Map<
    string,
    {
      resolve: (decision: PermissionDecision) => void;
      sessionId: string;
      action: string;
      detail: string;
    }
  >();
  private readonly pendingExtensionUi = new Map<
    string,
    {
      resolve: (response: import('./extension-ui-bridge.js').ExtensionUiResponse) => void;
      kind: import('./extension-ui-bridge.js').ExtensionUiKind;
    }
  >();
  private readonly transcriptRecorders = new Map<
    string,
    ReturnType<typeof createTranscriptRecorder>
  >();
  private mcpManager: McpLifecycleManager | null = null;
  private processRegistry: ProcessRegistry | null = null;
  private memoryStore: MemoryStore | null = null;
  private cardStore: import('@piwin/flashcards').CardStore | null = null;
  private readonly options: HostRuntimeOptions;
  private ready = true;

  constructor(options: HostRuntimeOptions) {
    this.options = options;
    // Single process owner for Desktop UI lifecycle + SDK session tools.
    const rootDir = getPiwinRoot(options.piwinRoot);
    const mcpManager = createMcpLifecycleManager(rootDir);
    this.mcpManager = mcpManager;
    const processRegistry = createProcessRegistry({
      getTrustedProjectRoots: async () => {
        try {
          const projects = await listProjects(getPiwinProjectsPath(rootDir));
          return projects
            .filter((project) => project.trust === 'trusted')
            .map((project) => project.path);
        } catch {
          return [];
        }
      },
      onEvent: (event) => this.emitProcessEvent(event),
    });
    this.processRegistry = processRegistry;
    const createOptions: Parameters<typeof createAgentHost>[0] = {
      mode: options.mode,
      mock: options.mock === true,
      onPermissionRequest: async (request) => this.requestPermission(request),
      lifecycleManager: mcpManager,
      processRegistry,
      onExtensionUiRequest: async (request) => this.requestExtensionUi(request),
      onExtensionNotify: (message, level) => {
        this.push({
          type: 'host/log',
          level: level === 'warning' ? 'warn' : level,
          message: `[extension] ${message}`,
        });
      },
    };
    if (typeof options.piwinRoot === 'string') {
      createOptions.piwinRoot = options.piwinRoot;
    }
    if (typeof options.rpcCommand === 'string') {
      createOptions.rpcCommand = options.rpcCommand;
    }
    this.host = createAgentHost(createOptions);
  }

  getMode(): HostMode {
    return this.host.mode;
  }

  async dispose(): Promise<void> {
    if (this.processRegistry) {
      try {
        await this.processRegistry.dispose();
      } catch {
        // best-effort shutdown
      }
      this.processRegistry = null;
    }
    if (this.mcpManager) {
      try {
        await this.mcpManager.dispose();
      } catch {
        // best-effort shutdown
      }
      this.mcpManager = null;
    }
    for (const unsubscribe of this.unsubscribers.values()) {
      unsubscribe();
    }
    this.unsubscribers.clear();
    this.sessions.clear();
    this.sessionProjects.clear();
    this.pendingPermissions.clear();
    this.pendingExtensionUi.clear();
    await this.host.dispose();
    this.ready = false;
  }

  async handleCommand(command: HostCommand): Promise<HostResponse> {
    const requestId = typeof command.id === 'string' ? command.id : undefined;
    try {
      switch (command.type) {
        case 'host/ping':
          return ok(requestId, 'host/ping', { pong: true });
        case 'host/status':
          return ok(requestId, 'host/status', this.getStatus());
        case 'project/open': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const projectsPath = getPiwinProjectsPath(rootDir);
          // Opening alone does not trust; client must confirm.
          const project = await openOrCreateProject(projectsPath, command.path);
          return ok(requestId, 'project/open', {
            path: project.path,
            trusted: project.trust === 'trusted',
            trust: project.trust,
            project,
          });
        }
        case 'project/trust': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const projectsPath = getPiwinProjectsPath(rootDir);
          const project = await setProjectTrust(projectsPath, command.path, 'trusted');
          return ok(requestId, 'project/trust', {
            path: project.path,
            trusted: true,
            trust: project.trust,
            project,
          });
        }
        case 'session/list': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const indexPath = getPiwinSessionIndexPath(rootDir);
          const indexed = await listSessionsForProject(indexPath, command.projectPath);
          const sessions = indexed.map((item) => indexRecordToSummary(item));
          return ok(requestId, 'session/list', { sessions });
        }
        case 'session/create': {
          const session = await this.host.createSession(command.input);
          const lineage: {
            parentSessionId?: string;
            kind?: 'main' | 'subagent';
            depth?: number;
            subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled';
            task?: string;
          } = {
            kind: command.input.parentSessionId ? 'subagent' : 'main',
            depth: command.input.parentSessionId ? 1 : 0,
          };
          if (command.input.parentSessionId) {
            lineage.parentSessionId = command.input.parentSessionId;
            lineage.subagentStatus = 'running';
          }
          if (command.input.task) {
            lineage.task = command.input.task;
          }
          const executionMode = resolveExecutionMode(command.input.executionMode);
          this.sessionExecutionModes.set(session.id, executionMode);
          await this.bindSession(
            session,
            command.input.projectPath,
            command.input.sessionName,
            lineage,
          );
          this.pushStatus();
          return ok(requestId, 'session/create', {
            sessionId: session.id,
            executionMode,
          });
        }
        case 'session/spawn': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const indexPath = getPiwinSessionIndexPath(rootDir);
          const parent = await getSessionRecord(indexPath, command.parentSessionId);
          if (!parent) {
            return fail(
              requestId,
              'session/spawn',
              `Unknown parent session: ${command.parentSessionId}`,
            );
          }
          if (parent.kind === 'subagent' || (parent.depth ?? 0) >= 1) {
            return fail(
              requestId,
              'session/spawn',
              'sub-agent depth max is 1 (cannot nest sub-agents)',
            );
          }
          const task = command.task.trim();
          if (!task) {
            return fail(requestId, 'session/spawn', 'task is required');
          }
          const childName =
            command.sessionName?.trim() ||
            `subagent-${task.slice(0, 32).replace(/\s+/g, '-')}`;
          const child = await this.host.createSession({
            projectPath: parent.projectPath,
            sessionName: childName,
            parentSessionId: parent.id,
            task,
          });
          await this.bindSession(child, parent.projectPath, childName, {
            parentSessionId: parent.id,
            kind: 'subagent',
            depth: 1,
            subagentStatus: 'running',
            task,
          });
          // Seed task into child session (best-effort).
          try {
            await this.recordUserPrompt(child.id, { text: task });
            await child.prompt({ text: task });
            await this.touchSession(child.id, task);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `subagent seed prompt failed: ${message}`,
            });
          }
          this.pushStatus();
          return ok(requestId, 'session/spawn', {
            sessionId: child.id,
            parentSessionId: parent.id,
          });
        }
        case 'session/list-children': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const children = await listChildSessions(
            getPiwinSessionIndexPath(rootDir),
            command.parentSessionId,
          );
          return ok(requestId, 'session/list-children', {
            parentSessionId: command.parentSessionId,
            sessions: children,
          });
        }
        case 'session/cancel-subagent': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const indexPath = getPiwinSessionIndexPath(rootDir);
          const record = await getSessionRecord(indexPath, command.sessionId);
          if (!record) {
            return fail(
              requestId,
              'session/cancel-subagent',
              `Unknown session: ${command.sessionId}`,
            );
          }
          if (record.kind !== 'subagent') {
            return fail(
              requestId,
              'session/cancel-subagent',
              'session is not a sub-agent',
            );
          }
          const live = this.sessions.get(command.sessionId);
          if (live) {
            try {
              await live.abort();
            } catch {
              // ignore abort errors
            }
          }
          record.subagentStatus = 'cancelled';
          record.updatedAt = new Date().toISOString();
          await upsertSessionRecord(indexPath, record);
          return ok(requestId, 'session/cancel-subagent', {
            sessionId: command.sessionId,
            status: 'cancelled',
          });
        }
        case 'session/complete-subagent': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const indexPath = getPiwinSessionIndexPath(rootDir);
          const record = await getSessionRecord(indexPath, command.sessionId);
          if (!record) {
            return fail(
              requestId,
              'session/complete-subagent',
              `Unknown session: ${command.sessionId}`,
            );
          }
          if (record.kind !== 'subagent') {
            return fail(
              requestId,
              'session/complete-subagent',
              'session is not a sub-agent',
            );
          }
          const live = this.sessions.get(command.sessionId);
          if (live) {
            try {
              await live.abort();
            } catch {
              // ignore abort errors
            }
          }
          const nextStatus = command.status === 'failed' ? 'failed' : 'done';
          record.subagentStatus = nextStatus;
          record.updatedAt = new Date().toISOString();
          await upsertSessionRecord(indexPath, record);
          if (record.parentSessionId) {
            this.push({
              type: 'subagent/updated',
              parentSessionId: record.parentSessionId,
              child: indexRecordToSummary(record),
            });
          }
          this.push({
            type: 'host/log',
            level: 'info',
            message: `subagent ${command.sessionId} marked ${nextStatus}`,
          });
          return ok(requestId, 'session/complete-subagent', {
            sessionId: command.sessionId,
            status: nextStatus,
          });
        }
        case 'session/merge-subagent': {
          return this.handleMergeSubagent(requestId, command.childSessionId, command.force === true);
        }

        case 'session/pin': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const record = await pinSessionRecord(
            getPiwinSessionIndexPath(rootDir),
            command.sessionId,
          );
          if (!record) {
            return fail(requestId, 'session/pin', `Unknown session: ${command.sessionId}`);
          }
          return ok(requestId, 'session/pin', {
            sessionId: record.id,
            isPinned: true,
            pinnedAt: record.pinnedAt,
            session: indexRecordToSummary(record),
          });
        }
        case 'session/unpin': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const record = await unpinSessionRecord(
            getPiwinSessionIndexPath(rootDir),
            command.sessionId,
          );
          if (!record) {
            return fail(requestId, 'session/unpin', `Unknown session: ${command.sessionId}`);
          }
          return ok(requestId, 'session/unpin', {
            sessionId: record.id,
            isPinned: false,
            session: indexRecordToSummary(record),
          });
        }
        case 'session/search': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const result = await searchSessions(
            {
              indexPath: getPiwinSessionIndexPath(rootDir),
              resolveTranscriptPath: (sessionId) =>
                getPiwinSessionTranscriptPath(rootDir, sessionId),
            },
            command.query,
          );
          return ok(requestId, 'session/search', result);
        }
        case 'session/truncate-from': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const indexPath = getPiwinSessionIndexPath(rootDir);
          const record = await getSessionRecord(indexPath, command.sessionId);
          if (!record) {
            return fail(
              requestId,
              'session/truncate-from',
              `Unknown session: ${command.sessionId}`,
            );
          }
          const transcriptPath = getPiwinSessionTranscriptPath(rootDir, command.sessionId);
          const truncated = await truncateTranscriptFrom(transcriptPath, command.messageId);
          // Drop live handle so next prompt rebuilds from product transcript only.
          const live = this.sessions.get(command.sessionId);
          if (live) {
            try {
              await live.abort();
            } catch {
              // ignore
            }
            const unsub = this.unsubscribers.get(command.sessionId);
            if (unsub) {
              unsub();
              this.unsubscribers.delete(command.sessionId);
            }
            this.transcriptRecorders.delete(command.sessionId);
            this.sessions.delete(command.sessionId);
          }
          const remaining = truncated.document?.messages ?? [];
          record.messageCount = remaining.length;
          const last = remaining[remaining.length - 1];
          if (last?.text) {
            record.lastPreview = last.text.slice(0, 160);
          } else {
            delete record.lastPreview;
          }
          record.updatedAt = new Date().toISOString();
          await upsertSessionRecord(indexPath, record);
          return ok(requestId, 'session/truncate-from', {
            sessionId: command.sessionId,
            removedCount: truncated.removedCount,
            remainingCount: truncated.remainingCount,
            messages: remaining,
            session: indexRecordToSummary(record),
          });
        }
        case 'session/resume': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const existing = await getSessionRecord(
            getPiwinSessionIndexPath(rootDir),
            command.sessionId,
          );
          if (!existing) {
            return fail(requestId, 'session/resume', `Unknown session: ${command.sessionId}`);
          }
          const messages = await this.loadTranscriptMessages(command.sessionId);
          let session: SessionHandle;
          let live = true;
          try {
            session = await this.host.resumeSession(command.sessionId);
          } catch (error) {
            // Cross-process: adapter may not hold the Pi handle. Bind a product shell
            // that keeps stable id + transcript and creates a live session on first prompt.
            const message = error instanceof Error ? error.message : String(error);
            this.push({
              type: 'host/log',
              level: 'info',
              message: `resume fallback to product shell: ${message}`,
            });
            const shellOptions: Parameters<typeof createProductShellSession>[0] = {
              sessionId: command.sessionId,
              projectPath: existing.projectPath,
              seedMessages: messages,
              createLiveSession: async (input) => this.host.createSession(input),
            };
            if (existing.name) {
              shellOptions.sessionName = existing.name;
            }
            session = createProductShellSession(shellOptions);
            live = true;
          }
          await this.bindSession(session, existing.projectPath, existing.name);
          const data: SessionResumeData = {
            sessionId: session.id,
            live,
            messages,
            projectPath: existing.projectPath,
            outline: buildSessionOutline(messages),
          };
          if (existing.name) {
            data.name = existing.name;
          }
          return ok(requestId, 'session/resume', data);
        }
        case 'session/messages': {
          const messages = await this.loadTranscriptMessages(command.sessionId);
          return ok(requestId, 'session/messages', {
            sessionId: command.sessionId,
            messages,
          });
        }
        case 'session/prompt': {
          // Persist original user text + attachments (before path-injection rewrite).
          try {
            await this.recordUserPrompt(command.sessionId, command.input);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `transcript user write failed: ${message}`,
            });
          }
          const promptInput = this.buildModelPromptInput(command.input);
          // CE-CHAT / ADR 0009: rebuild next model prompt from product transcript.
          try {
            const transcriptMessages = await this.loadTranscriptMessages(command.sessionId);
            const lastMessageId = transcriptMessages[transcriptMessages.length - 1]?.id;
            const history = buildProductHistoryContext(
              transcriptMessages,
              lastMessageId ? { excludeMessageId: lastMessageId } : {},
            );
            if (history) {
              promptInput.text = mergeProductHistoryIntoPrompt(history, promptInput.text);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `product history inject failed: ${message}`,
            });
          }
          const planPath = getPiwinSessionPlanPath(
            getPiwinRoot(this.options.piwinRoot),
            command.sessionId,
          );
          const activePlan = await loadSessionPlan(planPath);
          if (
            activePlan &&
            (activePlan.status === 'approved' || activePlan.status === 'executing')
          ) {
            promptInput.text =
              `${formatPlanForModelContext(activePlan)}\n\n${promptInput.text}`;
          }
          try {
            promptInput.text = await this.maybeInjectMemoryOverview(
              command.sessionId,
              promptInput.text,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `memory overview inject failed: ${message}`,
            });
          }
          this.sessionLastPromptText.set(command.sessionId, command.input.text);
          // Ensure a live session exists after truncate (product shell rebuild).
          const liveSession = await this.ensureLiveSession(command.sessionId);
          await liveSession.prompt(promptInput);
          try {
            await this.touchSession(command.sessionId, command.input.text);
          } catch (error) {
            // Index persistence is best-effort; never fail the live prompt path.
            const message = error instanceof Error ? error.message : String(error);
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `session index touch failed: ${message}`,
            });
          }
          return ok(requestId, 'session/prompt', { sessionId: command.sessionId });
        }
        case 'session/abort': {
          await this.requireSession(command.sessionId).abort();
          return ok(requestId, 'session/abort', { sessionId: command.sessionId });
        }
        case 'session/steer': {
          await this.requireSession(command.sessionId).steer(command.message);
          return ok(requestId, 'session/steer', { sessionId: command.sessionId });
        }
        case 'session/follow_up': {
          await this.requireSession(command.sessionId).followUp(command.message);
          return ok(requestId, 'session/follow_up', { sessionId: command.sessionId });
        }
        case 'session/compact': {
          const session = this.requireSession(command.sessionId);
          if (!session.compact) {
            return fail(
              requestId,
              'session/compact',
              'compaction is not supported on this session (RPC or inactive product shell)',
            );
          }
          const startedAt = Date.now();
          const result = command.customInstructions
            ? await session.compact(command.customInstructions)
            : await session.compact();
          const durationMs =
            typeof result.durationMs === 'number' ? result.durationMs : Date.now() - startedAt;
          const data: {
            ok: boolean;
            message?: string;
            summary?: string;
            tokensBefore?: number;
            tokensAfter?: number;
            durationMs?: number;
          } = { ok: result.ok, durationMs };
          if (result.message) data.message = result.message;
          if (result.summary) data.summary = result.summary;
          if (typeof result.tokensBefore === 'number') data.tokensBefore = result.tokensBefore;
          if (typeof result.tokensAfter === 'number') data.tokensAfter = result.tokensAfter;
          return ok(requestId, 'session/compact', data);
        }
        case 'session/compact-abort': {
          const session = this.requireSession(command.sessionId);
          if (session.abortCompaction) {
            session.abortCompaction();
          }
          return ok(requestId, 'session/compact-abort', { sessionId: command.sessionId });
        }
        case 'session/compaction-settings': {
          const session = this.requireSession(command.sessionId);
          const supported = typeof session.getAutoCompactionEnabled === 'function';
          const resolved = await this.resolveAutoCompaction(command.sessionId);
          return ok(requestId, 'session/compaction-settings', {
            supported,
            autoCompactionEnabled: supported
              ? Boolean(session.getAutoCompactionEnabled?.())
              : resolved.enabled,
            source: resolved.source,
            globalDefault: resolved.globalDefault,
          });
        }
        case 'session/set-auto-compaction': {
          const session = this.requireSession(command.sessionId);
          if (!session.setAutoCompactionEnabled) {
            return fail(
              requestId,
              'session/set-auto-compaction',
              'auto-compaction settings not supported on this session',
            );
          }
          this.sessionAutoCompactionOverrides.set(command.sessionId, command.enabled);
          session.setAutoCompactionEnabled(command.enabled);
          return ok(requestId, 'session/set-auto-compaction', {
            enabled: command.enabled,
            source: 'session' as const,
          });
        }
        case 'media/save': {
          this.requireSession(command.input.sessionId);
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const config = await loadPiwinConfig(rootDir);
          const mediaService = createMediaService({
            mediaRoot: getPiwinMediaDir(rootDir),
            maxPasteBytes: config.media.maxPasteBytes,
            allowedMimeTypes: config.media.allowedMimeTypes,
          });
          const bytes = decodeBase64Media(command.input.base64Data);
          const asset = await mediaService.saveMediaAsset({
            sessionId: command.input.sessionId,
            bytes,
            mimeType: command.input.mimeType,
            source: command.input.source,
          });
          const data: MediaSaveData = { asset };
          return ok(requestId, 'media/save', data);
        }
        case 'skills/list': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          await ensureBundledSkillsInstalled(rootDir);
          const config = await loadPiwinConfig(rootDir);
          const scanOptions: Parameters<typeof scanSkills>[0] = {
            piwinRoot: rootDir,
          };
          if (config.skills) {
            scanOptions.skillsConfig = config.skills;
          }
          if (typeof command.projectPath === 'string' && command.projectPath.trim()) {
            scanOptions.projectPath = command.projectPath;
          }
          const skills = await scanSkills(scanOptions);
          return ok(requestId, 'skills/list', { skills });
        }
        case 'skills/set_enabled': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const config = await loadPiwinConfig(rootDir);
          const skillsConfig = config.skills ?? { extraPaths: [], disabledIds: [] };
          const disabled = new Set(skillsConfig.disabledIds);
          if (command.enabled) {
            disabled.delete(command.skillId);
          } else {
            disabled.add(command.skillId);
          }
          config.skills = {
            extraPaths: skillsConfig.extraPaths,
            disabledIds: [...disabled],
          };
          await savePiwinConfig(config, rootDir);
          return ok(requestId, 'skills/set_enabled', {
            skillId: command.skillId,
            enabled: command.enabled,
            disabledIds: config.skills.disabledIds,
          });
        }
        case 'skills/install': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const installOptions: Parameters<typeof installSkill>[0] = {
            piwinRoot: rootDir,
            source: command.source,
          };
          if (typeof command.name === 'string' && command.name.trim()) {
            installOptions.name = command.name.trim();
          }
          const result = await installSkill(installOptions);
          return ok(requestId, 'skills/install', {
            skillId: result.skillId,
            targetPath: result.targetPath,
          });
        }
        case 'extensions/list': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          await ensureBundledExtensionsInstalled(rootDir);
          const config = await loadPiwinConfig(rootDir);
          const scanOptions: Parameters<typeof scanExtensions>[0] = {
            piwinRoot: rootDir,
          };
          if (config.extensions) {
            scanOptions.extensionsConfig = config.extensions;
          }
          if (typeof command.projectPath === 'string' && command.projectPath.trim()) {
            scanOptions.projectPath = command.projectPath;
          }
          const extensions = await scanExtensions(scanOptions);
          return ok(requestId, 'extensions/list', { extensions });
        }
        case 'extensions/set_enabled': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const config = await loadPiwinConfig(rootDir);
          const extensionsConfig = config.extensions ?? {
            extraPaths: [],
            disabledIds: [],
          };
          const disabled = new Set(extensionsConfig.disabledIds);
          if (command.enabled) {
            disabled.delete(command.extensionId);
          } else {
            disabled.add(command.extensionId);
          }
          config.extensions = {
            extraPaths: extensionsConfig.extraPaths,
            disabledIds: [...disabled],
          };
          await savePiwinConfig(config, rootDir);
          return ok(requestId, 'extensions/set_enabled', {
            extensionId: command.extensionId,
            enabled: command.enabled,
            disabledIds: config.extensions.disabledIds,
          });
        }
        case 'extensions/ensure-bundled': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const installed = await ensureBundledExtensionsInstalled(rootDir);
          return ok(requestId, 'extensions/ensure-bundled', {
            installed,
          });
        }
        case 'extensions/install': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const installOptions: Parameters<typeof installExtension>[0] = {
            piwinRoot: rootDir,
            source: command.source,
          };
          if (typeof command.name === 'string' && command.name.trim()) {
            installOptions.name = command.name.trim();
          }
          const result = await installExtension(installOptions);
          return ok(requestId, 'extensions/install', {
            extensionId: result.extensionId,
            targetPath: result.targetPath,
          });
        }
        case 'prompts/list': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          await ensureBundledPromptsInstalled(rootDir);
          const config = await loadPiwinConfig(rootDir);
          const scanOptions: Parameters<typeof scanPrompts>[0] = {
            piwinRoot: rootDir,
          };
          if (config.prompts) {
            scanOptions.promptsConfig = config.prompts;
          }
          if (typeof command.projectPath === 'string' && command.projectPath.trim()) {
            scanOptions.projectPath = command.projectPath;
          }
          const prompts = await scanPrompts(scanOptions);
          return ok(requestId, 'prompts/list', { prompts });
        }
        case 'prompts/set_enabled': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const config = await loadPiwinConfig(rootDir);
          const promptsConfig = config.prompts ?? {
            extraPaths: [],
            disabledIds: [],
          };
          const disabled = new Set(promptsConfig.disabledIds);
          if (command.enabled) {
            disabled.delete(command.promptId);
          } else {
            disabled.add(command.promptId);
          }
          config.prompts = {
            extraPaths: promptsConfig.extraPaths,
            disabledIds: [...disabled],
          };
          await savePiwinConfig(config, rootDir);
          return ok(requestId, 'prompts/set_enabled', {
            promptId: command.promptId,
            enabled: command.enabled,
            disabledIds: config.prompts.disabledIds,
          });
        }
        case 'mcp/get': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const document = await loadMcpConfig(rootDir);
          return ok(requestId, 'mcp/get', {
            document,
            path: getMcpConfigPath(rootDir),
          });
        }
        case 'mcp/validate': {
          const result = tryValidateMcpConfig(command.document);
          if (result.ok) {
            return ok(requestId, 'mcp/validate', { valid: true, document: result.document });
          }
          return ok(requestId, 'mcp/validate', { valid: false, issues: result.issues });
        }
        case 'mcp/save': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const validated = tryValidateMcpConfig(command.document);
          if (!validated.ok) {
            return fail(
              requestId,
              'mcp/save',
              validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
            );
          }
          const path = await saveMcpConfig(rootDir, validated.document);
          return ok(requestId, 'mcp/save', { path, document: validated.document });
        }
        case 'mcp/list_tools': {
          const tools = await this.getMcpManager().listTools(command.serverId);
          return ok(requestId, 'mcp/list_tools', { serverId: command.serverId, tools });
        }
        case 'mcp/status': {
          const servers = await this.getMcpManager().listHealth();
          return ok(requestId, 'mcp/status', { servers });
        }
        case 'mcp/start': {
          const health = await this.getMcpManager().start(command.serverId);
          return ok(requestId, 'mcp/start', { health });
        }
        case 'mcp/stop': {
          const health = await this.getMcpManager().stop(command.serverId);
          return ok(requestId, 'mcp/stop', { health });
        }
        case 'git/status': {
          const git = createGitService();
          const snapshot = await git.getStatus(command.projectPath);
          return ok(requestId, 'git/status', { snapshot });
        }
        case 'git/diff-summary': {
          const git = createGitService();
          const summary = await git.getDiffSummary(command.projectPath);
          return ok(requestId, 'git/diff-summary', { summary });
        }
        case 'git/log-graph': {
          const git = createGitService();
          const graph = await git.getCommitGraph(
            command.projectPath,
            typeof command.limit === 'number' ? command.limit : undefined,
          );
          return ok(requestId, 'git/log-graph', { graph });
        }
        case 'git/stage': {
          const git = createGitService();
          const result = await git.stage(command.input);
          return ok(requestId, 'git/stage', { result });
        }
        case 'git/unstage': {
          const git = createGitService();
          const result = await git.unstage(command.input);
          return ok(requestId, 'git/unstage', { result });
        }
        case 'git/commit': {
          const git = createGitService();
          const result = await git.commit(command.input);
          return ok(requestId, 'git/commit', { result });
        }
        case 'git/branch-create': {
          const git = createGitService();
          const result = await git.createBranch(command.input);
          return ok(requestId, 'git/branch-create', { result });
        }
        case 'git/checkout': {
          const git = createGitService();
          const result = await git.checkout(command.input);
          return ok(requestId, 'git/checkout', { result });
        }
        case 'theme/list': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const data = await listThemes(rootDir);
          return ok(requestId, 'theme/list', data);
        }
        case 'theme/get-active': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const theme = await getActiveTheme(rootDir);
          return ok(requestId, 'theme/get-active', { theme });
        }
        case 'theme/set-active': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const theme = await setActiveTheme(rootDir, command.themeId);
          return ok(requestId, 'theme/set-active', { theme });
        }
        case 'theme/install-local': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const installed = await installThemeFromLocalPath(rootDir, command.sourcePath);
          return ok(requestId, 'theme/install-local', installed);
        }
        case 'pet/list': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const data = await listPets(rootDir);
          return ok(requestId, 'pet/list', data);
        }
        case 'pet/get-active': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const pet = await getActivePet(rootDir);
          return ok(requestId, 'pet/get-active', { pet });
        }
        case 'pet/set-active': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const pet = await setActivePet(rootDir, command.petId);
          return ok(requestId, 'pet/set-active', { pet });
        }
        case 'pet/install-local': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const installed = await installPetFromLocalPath(rootDir, command.sourcePath);
          return ok(requestId, 'pet/install-local', installed);
        }
        case 'pet/import-codex': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const result = await importPetsFromCodex(rootDir);
          return ok(requestId, 'pet/import-codex', result);
        }

        case 'plan/get': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
          const plan = await loadSessionPlan(planPath);
          return ok(requestId, 'plan/get', { sessionId: command.sessionId, plan });
        }
        case 'plan/set': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const existing = await getSessionRecord(
            getPiwinSessionIndexPath(rootDir),
            command.sessionId,
          );
          if (!existing) {
            return fail(requestId, 'plan/set', `Unknown session: ${command.sessionId}`);
          }
          const validated = validateSessionPlan(command.plan);
          if (!validated.ok) {
            return fail(
              requestId,
              'plan/set',
              validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
            );
          }
          const now = new Date().toISOString();
          const previous = await loadSessionPlan(
            getPiwinSessionPlanPath(rootDir, command.sessionId),
          );
          const plan = {
            ...validated.plan,
            sessionId: command.sessionId,
            projectPath: existing.projectPath,
            id: previous?.id ?? validated.plan.id,
            createdAt: previous?.createdAt ?? validated.plan.createdAt ?? now,
            updatedAt: now,
            revision: previous ? previous.revision + 1 : validated.plan.revision,
          };
          await saveSessionPlan(getPiwinSessionPlanPath(rootDir, command.sessionId), plan);
          this.push({ type: 'plan/updated', sessionId: command.sessionId, plan });
          return ok(requestId, 'plan/set', { plan });
        }
        case 'plan/clear': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          await clearSessionPlan(getPiwinSessionPlanPath(rootDir, command.sessionId));
          this.push({ type: 'plan/updated', sessionId: command.sessionId, plan: null });
          return ok(requestId, 'plan/clear', { sessionId: command.sessionId });
        }
        case 'plan/approve': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
          const plan = await loadSessionPlan(planPath);
          if (!plan) {
            return fail(requestId, 'plan/approve', 'No plan for session');
          }
          if (plan.status !== 'draft' && plan.status !== 'approved') {
            return fail(
              requestId,
              'plan/approve',
              `Cannot approve plan in status ${plan.status}`,
            );
          }
          const approved = {
            ...plan,
            status: 'approved' as const,
            revision: plan.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          await saveSessionPlan(planPath, approved);
          this.push({ type: 'plan/updated', sessionId: command.sessionId, plan: approved });
          return ok(requestId, 'plan/approve', { plan: approved });
        }
        case 'plan/update-step': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
          const plan = await loadSessionPlan(planPath);
          if (!plan) {
            return fail(requestId, 'plan/update-step', 'No plan for session');
          }
          const result = applyPlanStepUpdate({
            plan,
            stepId: command.stepId,
            status: command.status,
            ...(typeof command.detail === 'string' ? { detail: command.detail } : {}),
          });
          if (!result.ok) {
            return fail(requestId, 'plan/update-step', result.error);
          }
          await saveSessionPlan(planPath, result.plan);
          this.push({ type: 'plan/updated', sessionId: command.sessionId, plan: result.plan });
          if (result.plan.status !== plan.status) {
            this.push({
              type: 'host/log',
              level: 'info',
              message: `plan ${command.sessionId} status ${plan.status} → ${result.plan.status}`,
            });
          }
          return ok(requestId, 'plan/update-step', { plan: result.plan });
        }
        case 'plan/set-status': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const planPath = getPiwinSessionPlanPath(rootDir, command.sessionId);
          const plan = await loadSessionPlan(planPath);
          if (!plan) {
            return fail(requestId, 'plan/set-status', 'No plan for session');
          }
          const result = applyPlanStatus({ plan, status: command.status });
          if (!result.ok) {
            return fail(requestId, 'plan/set-status', result.error);
          }
          await saveSessionPlan(planPath, result.plan);
          this.push({ type: 'plan/updated', sessionId: command.sessionId, plan: result.plan });
          return ok(requestId, 'plan/set-status', { plan: result.plan });
        }

        case 'config/get': {
          const configRoot = getPiwinRoot(this.options.piwinRoot);
          const config = await loadPiwinConfig(configRoot);
          return ok(requestId, 'config/get', { config, root: configRoot });
        }
        case 'config/set': {
          const configRoot = getPiwinRoot(this.options.piwinRoot);
          const path = await savePiwinConfig(command.config, configRoot);
          return ok(requestId, 'config/set', { path });
        }
        case 'permission/resolve': {
          const pending = this.pendingPermissions.get(command.requestId);
          if (pending) {
            if (
              command.decision === 'allow' &&
              command.rememberScope === 'project'
            ) {
              await this.rememberProjectPermission(
                pending.sessionId,
                pending.action,
                pending.detail,
              );
            }
            pending.resolve(command.decision);
            this.pendingPermissions.delete(command.requestId);
          }
          const resolveData: {
            requestId: string;
            decision: PermissionDecision;
            rememberScope?: 'once' | 'project';
          } = {
            requestId: command.requestId,
            decision: command.decision,
          };
          if (command.rememberScope) {
            resolveData.rememberScope = command.rememberScope;
          }
          return ok(requestId, 'permission/resolve', resolveData);
        }
        case 'extension/ui_resolve': {
          const pending = this.pendingExtensionUi.get(command.requestId);
          if (!pending) {
            return fail(
              requestId,
              'extension/ui_resolve',
              `Unknown extension UI request: ${command.requestId}`,
            );
          }
          this.pendingExtensionUi.delete(command.requestId);
          if (pending.kind === 'confirm') {
            pending.resolve({
              kind: 'confirm',
              confirmed: command.confirmed === true && command.cancelled !== true,
            });
          } else if (pending.kind === 'select') {
            if (command.cancelled === true || command.value === undefined) {
              pending.resolve({ kind: 'select', cancelled: true });
            } else {
              pending.resolve({ kind: 'select', value: command.value });
            }
          } else if (command.cancelled === true || command.value === undefined) {
            pending.resolve({ kind: 'input', cancelled: true });
          } else {
            pending.resolve({ kind: 'input', value: command.value });
          }
          return ok(requestId, 'extension/ui_resolve', {
            requestId: command.requestId,
            ok: true,
          });
        }
        case 'process/list': {
          const registry = this.getProcessRegistry();
          const filter: { sessionId?: string; projectPath?: string } = {};
          if (command.sessionId) filter.sessionId = command.sessionId;
          if (command.projectPath) filter.projectPath = command.projectPath;
          const processes = registry.list(
            Object.keys(filter).length > 0 ? filter : undefined,
          );
          return ok(requestId, 'process/list', { processes });
        }
        case 'process/get': {
          const registry = this.getProcessRegistry();
          const processRecord = registry.get(command.processId);
          if (!processRecord) {
            return fail(requestId, 'process/get', `Unknown process: ${command.processId}`);
          }
          return ok(requestId, 'process/get', { process: processRecord });
        }
        case 'process/start': {
          // IPC start is host-authoritative (Desktop/CLI). Agent tools gate via process:start ask.
          const registry = this.getProcessRegistry();
          const processRecord = await registry.start(command.input);
          return ok(requestId, 'process/start', { process: processRecord });
        }
        case 'process/logs': {
          const registry = this.getProcessRegistry();
          const chunks = registry.readLogs(command.query);
          return ok(requestId, 'process/logs', {
            processId: command.query.processId,
            chunks,
          });
        }
        case 'process/stop': {
          // UI Stop is explicit user intent; tools still gate via process:stop ask.
          const registry = this.getProcessRegistry();
          const processRecord = await registry.stop(command.processId);
          return ok(requestId, 'process/stop', { process: processRecord });
        }

        case 'memory/list': {
          await this.requireMemoryEnabled();
          const store = this.getMemoryStore();
          const records = await store.list(command.filter ?? {});
          return ok(requestId, 'memory/list', { records });
        }
        case 'memory/read': {
          await this.requireMemoryEnabled();
          const store = this.getMemoryStore();
          const record = await store.read(command.memoryId);
          return ok(requestId, 'memory/read', { record });
        }
        case 'memory/search': {
          await this.requireMemoryEnabled();
          const store = this.getMemoryStore();
          const hits = await store.search(command.query);
          return ok(requestId, 'memory/search', { hits });
        }
        case 'memory/write': {
          await this.requireMemoryEnabled();
          const store = this.getMemoryStore();
          const record = await store.write(command.input);
          return ok(requestId, 'memory/write', { record });
        }
        case 'memory/update': {
          await this.requireMemoryEnabled();
          const store = this.getMemoryStore();
          const record = await store.update(command.input);
          return ok(requestId, 'memory/update', { record });
        }
        case 'memory/delete': {
          await this.requireMemoryEnabled();
          const store = this.getMemoryStore();
          const result = await store.delete(command.memoryId);
          return ok(requestId, 'memory/delete', result);
        }
        case 'memory/accept': {
          await this.requireMemoryEnabled();
          const store = this.getMemoryStore();
          const record = await store.accept(command.memoryId);
          return ok(requestId, 'memory/accept', { record });
        }
        case 'memory/quota': {
          await this.requireMemoryEnabled();
          const store = this.getMemoryStore();
          const quotaOptions: { scope?: 'global' | 'project'; projectKey?: string } = {};
          if (command.scope) quotaOptions.scope = command.scope;
          if (command.projectKey) quotaOptions.projectKey = command.projectKey;
          const summaries = await store.quotaSummary(quotaOptions);
          return ok(requestId, 'memory/quota', { summaries });
        }

        case 'flashcards/create': {
          const store = await this.getCardStore();
          const card = await store.create(command.input);
          return ok(requestId, 'flashcards/create', { card });
        }
        case 'flashcards/list': {
          const store = await this.getCardStore();
          const filter: { deck?: string; sourceNoteId?: string } = {};
          if (command.deck) filter.deck = command.deck;
          if (command.sourceNoteId) filter.sourceNoteId = command.sourceNoteId;
          const cards = await store.list(filter);
          return ok(requestId, 'flashcards/list', { cards });
        }
        case 'flashcards/delete': {
          const store = await this.getCardStore();
          const result = await store.delete(command.cardId);
          return ok(requestId, 'flashcards/delete', result);
        }
        case 'flashcards/decks': {
          const store = await this.getCardStore();
          const decks = await store.listDecks();
          return ok(requestId, 'flashcards/decks', { decks });
        }
        case 'flashcards/queue': {
          const store = await this.getCardStore();
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const config = await loadPiwinConfig(rootDir);
          const { buildReviewQueue } = await import('@piwin/flashcards');
          const cards = await store.list();
          const states = await store.loadReviewStates();
          const queue = buildReviewQueue({
            cards,
            states,
            ...(command.deck ? { deck: command.deck } : {}),
            ...(typeof config.flashcards?.newPerDay === 'number'
              ? { newPerDay: config.flashcards.newPerDay }
              : {}),
            ...(typeof config.flashcards?.maxReviewsPerDay === 'number'
              ? { maxReviewsPerDay: config.flashcards.maxReviewsPerDay }
              : {}),
          });
          return ok(requestId, 'flashcards/queue', { queue });
        }
        case 'flashcards/rate': {
          // Direct user intent from UI (review panel / artifact rate button);
          // no permission gate — equivalent to clicking in the product shell.
          const store = await this.getCardStore();
          const state = await store.rate(command.cardId, command.rating);
          return ok(requestId, 'flashcards/rate', { state });
        }

        case 'session/export': {
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const indexPath = getPiwinSessionIndexPath(rootDir);
          const record = await getSessionRecord(indexPath, command.sessionId);
          if (!record) {
            return fail(
              requestId,
              'session/export',
              `Unknown session: ${command.sessionId}`,
            );
          }
          const format = command.format === 'html' ? 'html' : 'md';
          const redactTools = command.redactTools === true;
          const messages = await this.loadTranscriptMessages(command.sessionId);
          const exported = exportTranscript(messages, {
            format,
            redactTools,
            sessionId: command.sessionId,
            projectPath: record.projectPath,
            ...(record.name ? { title: record.name } : {}),
          });
          let outputPath: string;
          if (command.outputPath && command.outputPath.trim()) {
            const candidate = command.outputPath.trim();
            outputPath = isAbsolute(candidate) ? candidate : resolvePath(candidate);
          } else {
            const basename = suggestSessionExportBasename(command.sessionId, format);
            outputPath = resolvePath(
              getPiwinSessionDir(rootDir, command.sessionId),
              'exports',
              basename,
            );
          }
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, exported.content, 'utf8');
          const byteLength = Buffer.byteLength(exported.content, 'utf8');
          return ok(requestId, 'session/export', {
            sessionId: command.sessionId,
            format,
            redactTools,
            path: outputPath,
            byteLength,
          });
        }
        default:
          return fail(requestId, 'unknown', 'Unhandled command');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(requestId, command.type, message);
    }
  }

  /** Trust project explicitly after user confirms. */
  async trustProject(projectPath: string): Promise<unknown> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    return setProjectTrust(getPiwinProjectsPath(rootDir), projectPath, 'trusted');
  }

  /**
   * Emit a permission request to the UI and wait for permission/resolve.
   * Used by gated tools (web_search / web_fetch) during live sessions.
   */
  requestPermission(input: {
    sessionId: string;
    action: string;
    detail: string;
    defaultDecision: PermissionDecision;
  }): Promise<PermissionDecision> {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      this.pendingPermissions.set(requestId, {
        resolve,
        sessionId: input.sessionId,
        action: input.action,
        detail: input.detail,
      });
      this.push({
        type: 'permission/request',
        sessionId: input.sessionId,
        requestId,
        action: input.action,
        detail: input.detail,
        defaultDecision: input.defaultDecision,
      });
      this.push({
        type: 'event',
        sessionId: input.sessionId,
        event: {
          type: 'permission/request',
          requestId,
          action: input.action,
          detail: input.detail,
          defaultDecision: input.defaultDecision,
        },
      });
    });
  }

  waitForPermission(requestId: string): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      this.pendingPermissions.set(requestId, {
        resolve,
        sessionId: '',
        action: '',
        detail: '',
      });
    });
  }

  /**
   * Bridge Pi ExtensionUIContext confirm/select/input to Desktop (D-EXT-04).
   */
  requestExtensionUi(
    input: import('./extension-ui-bridge.js').ExtensionUiRequest & { sessionId: string },
  ): Promise<import('./extension-ui-bridge.js').ExtensionUiResponse> {
    return new Promise((resolve) => {
      this.pendingExtensionUi.set(input.requestId, {
        resolve,
        kind: input.kind,
      });
      const pushMessage: {
        type: 'extension/ui_request';
        sessionId: string;
        requestId: string;
        kind: import('./extension-ui-bridge.js').ExtensionUiKind;
        title: string;
        message?: string;
        options?: string[];
        placeholder?: string;
      } = {
        type: 'extension/ui_request',
        sessionId: input.sessionId,
        requestId: input.requestId,
        kind: input.kind,
        title: input.title,
      };
      if (input.message !== undefined) {
        pushMessage.message = input.message;
      }
      if (input.options !== undefined) {
        pushMessage.options = input.options;
      }
      if (input.placeholder !== undefined) {
        pushMessage.placeholder = input.placeholder;
      }
      this.push(pushMessage);
    });
  }

  private async rememberProjectPermission(
    sessionId: string,
    action: string,
    detail: string,
  ): Promise<void> {
    if (!action.startsWith('network:') && !action.startsWith('mcp:')) {
      return;
    }
    const projectPath = this.sessionProjects.get(sessionId);
    if (!projectPath) {
      return;
    }
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const projectsFile = getPiwinProjectsPath(rootDir);
    if (action === 'mcp:connect' || action === 'mcp:tool-call') {
      // Connect: "<serverId>: <command>"; tool-call: "<serverId>/<toolName>"
      // Both persist the same server-level allowlist entry.
      const serverId = parseMcpServerIdFromPermissionDetail(action, detail);
      if (serverId) {
        await allowMcpServer(projectsFile, projectPath, serverId);
      }
      return;
    }
    if (action === 'network:web_search') {
      await allowNetworkWebSearch(projectsFile, projectPath);
      return;
    }
    if (action === 'network:web_fetch') {
      try {
        const hostname = new URL(detail).hostname;
        await allowNetworkFetchHost(projectsFile, projectPath, hostname);
      } catch {
        // ignore invalid url detail
      }
    }
  }

  /**
   * Attachments are accepted only from piwin's media root. The UI supplies a
   * structured reference; this boundary creates the text-model path metadata.
   */
  private buildModelPromptInput(input: PromptInput): PromptInput {
    if (!input.attachments || input.attachments.length === 0) {
      return input;
    }

    const mediaRoot = getPiwinMediaDir(getPiwinRoot(this.options.piwinRoot));
    const safeAttachments = input.attachments.map((attachment) =>
      validateMediaAttachment(mediaRoot, attachment),
    );
    const imageInjections = safeAttachments.map((attachment) =>
      formatTextModelImageInjection({
        absolutePath: attachment.path,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        ...(attachment.width !== undefined ? { width: attachment.width } : {}),
        ...(attachment.height !== undefined ? { height: attachment.height } : {}),
      }),
    );

    return {
      ...input,
      text: [input.text, ...imageInjections].filter(Boolean).join('\n\n'),
      attachments: safeAttachments,
    };
  }



  private getMemoryStore(): MemoryStore {
    if (!this.memoryStore) {
      const rootDir = getPiwinRoot(this.options.piwinRoot);
      this.memoryStore = createMemoryStore({ piwinRoot: rootDir });
    }
    return this.memoryStore;
  }

  private async getCardStore(): Promise<import('@piwin/flashcards').CardStore> {
    if (!this.cardStore) {
      const rootDir = getPiwinRoot(this.options.piwinRoot);
      const config = await loadPiwinConfig(rootDir);
      if (config.flashcards?.enabled === false) {
        throw new Error('Flashcards are disabled (config.flashcards.enabled=false).');
      }
      const { createCardStore } = await import('@piwin/flashcards');
      this.cardStore = createCardStore({ piwinRoot: rootDir });
    }
    return this.cardStore;
  }

  private async requireMemoryEnabled(): Promise<void> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const config = await loadPiwinConfig(rootDir);
    if (config.memory?.enabled !== true) {
      throw new Error(
        'Memory is disabled. Enable with config.memory.enabled=true (Settings → Agent → Memory or config/set).',
      );
    }
  }

  private async maybeInjectMemoryOverview(
    sessionId: string,
    promptText: string,
  ): Promise<string> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const config = await loadPiwinConfig(rootDir);
    const projectPath = this.sessionProjects.get(sessionId);
    let projectTrusted = false;
    let projectKey: string | undefined;
    if (projectPath) {
      projectKey = projectKeyFromPath(projectPath);
      try {
        const projectsPath = getPiwinProjectsPath(rootDir);
        const project = await openOrCreateProject(projectsPath, projectPath);
        projectTrusted = project.trust === 'trusted';
      } catch {
        projectTrusted = false;
      }
    }
    const injectGate: { projectTrusted: boolean; memoryConfig?: typeof config.memory } = {
      projectTrusted,
    };
    if (config.memory) {
      injectGate.memoryConfig = config.memory;
    }
    if (!shouldInjectMemoryOverview(injectGate)) {
      return promptText;
    }
    const store = this.getMemoryStore();
    const injectOptions: {
      store: MemoryStore;
      projectKey?: string;
      maxChars?: number;
      writeCache: boolean;
    } = { store, writeCache: true };
    if (projectKey) injectOptions.projectKey = projectKey;
    if (typeof config.memory?.maxOverviewChars === 'number') {
      injectOptions.maxChars = config.memory.maxOverviewChars;
    }
    const overview = await buildMemoryOverviewInjection(injectOptions);
    return prependMemoryOverview(promptText, overview);
  }

  private getProcessRegistry(): ProcessRegistry {
    if (!this.processRegistry) {
      throw new Error('Process registry is not available');
    }
    return this.processRegistry;
  }

  private emitProcessEvent(event: {
    type: string;
    process?: unknown;
    processId?: string;
    exitCode?: number | null;
    chunk?: unknown;
  }): void {
    const processRecord = event.process as { sessionId?: string } | undefined;
    const sessionId =
      (processRecord && typeof processRecord.sessionId === 'string'
        ? processRecord.sessionId
        : undefined) ??
      (typeof event.processId === 'string'
        ? this.processRegistry?.get(event.processId)?.sessionId
        : undefined) ??
      '';

    if (!sessionId) {
      return;
    }

    if (event.type === 'process/started' && event.process) {
      this.push({
        type: 'event',
        sessionId,
        event: {
          type: 'process/started',
          process: event.process as never,
        },
      });
      return;
    }
    if (event.type === 'process/updated' && event.process) {
      this.push({
        type: 'event',
        sessionId,
        event: {
          type: 'process/updated',
          process: event.process as never,
        },
      });
      return;
    }
    if (event.type === 'process/exited') {
      this.push({
        type: 'event',
        sessionId,
        event: {
          type: 'process/exited',
          processId: String(event.processId ?? ''),
          ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
          ...(event.process ? { process: event.process as never } : {}),
        },
      });
      return;
    }
    if (event.type === 'process/log' && event.chunk) {
      this.push({
        type: 'event',
        sessionId,
        event: {
          type: 'process/log',
          chunk: event.chunk as never,
        },
      });
    }
  }

  private getMcpManager(): McpLifecycleManager {
    if (!this.mcpManager) {
      // dispose() nulls the manager; recreate only if commands arrive after partial teardown.
      this.mcpManager = createMcpLifecycleManager(getPiwinRoot(this.options.piwinRoot));
    }
    return this.mcpManager;
  }


  private isRpcSdkFallback(): boolean {
    if (this.options.mock === true || process.env.PIWIN_MOCK === '1') {
      return false;
    }
    if (this.host.mode !== 'rpc') {
      return false;
    }
    const maybe = this.host as { usesSdkFallback?: () => boolean };
    if (typeof maybe.usesSdkFallback === 'function') {
      return maybe.usesSdkFallback();
    }
    // Default product path for rpc after D-EXT-07.
    return process.env.PIWIN_RPC_STOCK !== '1';
  }

  private getStatus(): HostStatusData {
    return {
      mode: this.host.mode,
      ready: this.ready,
      mock: this.options.mock === true || process.env.PIWIN_MOCK === '1',
      piwinRoot: getPiwinRoot(this.options.piwinRoot),
      activeSessionIds: [...this.sessions.keys()],
      capabilities: {
        // RPC product path uses SDK session backend (D-EXT-07) so tools work.
        customTools: this.host.mode === 'sdk' || this.isRpcSdkFallback(),
        mcpLifecycle: true,
        productTranscript: true,
        // Compaction requires a live handle with compact(); SDK/mock support it.
        compaction:
          this.host.mode === 'sdk' ||
          this.options.mock === true ||
          this.isRpcSdkFallback(),
        extensions: this.host.mode === 'sdk' || this.isRpcSdkFallback() || this.options.mock === true,
        prompts: this.host.mode === 'sdk' || this.isRpcSdkFallback() || this.options.mock === true,
        ...(this.host.mode === 'rpc' && this.isRpcSdkFallback()
          ? { rpcSdkFallback: true }
          : {}),
        extensionUiBridge: true,
        memory: true,
        sessionSearch: true,
        sessionPin: true,
        usage: true,
        process: true,
        sessionExport: true,
      },
    };
  }

  private pushStatus(): void {
    const status = this.getStatus();
    this.push({
      type: 'host/status',
      mode: status.mode,
      ready: status.ready,
      mock: status.mock,
    });
  }

  private async bindSession(
    session: SessionHandle,
    projectPath?: string,
    sessionName?: string,
    lineage?: {
      parentSessionId?: string;
      kind?: 'main' | 'subagent';
      depth?: number;
      subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled';
      task?: string;
    },
  ): Promise<void> {
    const existing = this.unsubscribers.get(session.id);
    if (existing) {
      existing();
    }
    this.sessions.set(session.id, session);
    if (projectPath) {
      this.sessionProjects.set(session.id, projectPath);
      const rootDir = getPiwinRoot(this.options.piwinRoot);
      const indexPath = getPiwinSessionIndexPath(rootDir);
      try {
        const current = await getSessionRecord(indexPath, session.id);
        if (current) {
          current.updatedAt = new Date().toISOString();
          if (sessionName) {
            current.name = sessionName;
          }
          if (lineage?.parentSessionId) {
            current.parentSessionId = lineage.parentSessionId;
          }
          if (lineage?.kind) {
            current.kind = lineage.kind;
          }
          if (typeof lineage?.depth === 'number') {
            current.depth = lineage.depth;
          }
          if (lineage?.subagentStatus) {
            current.subagentStatus = lineage.subagentStatus;
          }
          if (lineage?.task) {
            current.task = lineage.task;
          }
          await upsertSessionRecord(indexPath, current);
        } else {
          const recordInput: Parameters<typeof createSessionRecord>[0] = {
            id: session.id,
            projectPath,
            name: sessionName ?? `session-${session.id.slice(0, 8)}`,
          };
          if (lineage?.parentSessionId) {
            recordInput.parentSessionId = lineage.parentSessionId;
          }
          if (lineage?.kind) {
            recordInput.kind = lineage.kind;
          }
          if (typeof lineage?.depth === 'number') {
            recordInput.depth = lineage.depth;
          }
          if (lineage?.subagentStatus) {
            recordInput.subagentStatus = lineage.subagentStatus;
          }
          if (lineage?.task) {
            recordInput.task = lineage.task;
          }
          await upsertSessionRecord(indexPath, createSessionRecord(recordInput));
        }
      } catch {
        // best-effort index write
      }
    }

    this.ensureTranscriptRecorder(
      session.id,
      projectPath ?? this.sessionProjects.get(session.id) ?? 'unknown',
    );

    const unsubscribe = session.subscribe((event: AgentEvent) => {
      this.push({ type: 'event', sessionId: session.id, event });
      if (event.type === 'permission/request') {
        this.push({
          type: 'permission/request',
          sessionId: session.id,
          requestId: event.requestId,
          action: event.action,
          detail: event.detail,
          defaultDecision: event.defaultDecision,
        });
      }
      if (event.type === 'usage/update') {
        this.sessionUsage.set(session.id, event.usage);
      }
      // CE-OBS: if mock/host did not emit usage, estimate after assistant message ends.
      if (event.type === 'message/end') {
        void this.maybeEmitUsageOnMessageEnd(session.id, event.messageId);
      }
      const recorder = this.transcriptRecorders.get(session.id);
      if (recorder) {
        void recorder.recordEvent(event).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.push({
            type: 'host/log',
            level: 'warn',
            message: `transcript event write failed: ${message}`,
          });
        });
      }
    });
    this.unsubscribers.set(session.id, unsubscribe);

    // Apply durable auto-compaction default (or session override) when handle supports it.
    void this.applyAutoCompactionToSession(session).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `auto-compaction apply failed: ${message}`,
      });
    });
  }

  private async resolveAutoCompaction(sessionId: string): Promise<{
    enabled: boolean;
    source: 'session' | 'global' | 'unknown';
    globalDefault: boolean;
  }> {
    const config = await loadPiwinConfig(getPiwinRoot(this.options.piwinRoot));
    const globalDefault = config.compaction?.autoEnabledDefault !== false;
    if (this.sessionAutoCompactionOverrides.has(sessionId)) {
      return {
        enabled: Boolean(this.sessionAutoCompactionOverrides.get(sessionId)),
        source: 'session',
        globalDefault,
      };
    }
    return { enabled: globalDefault, source: 'global', globalDefault };
  }

  private async applyAutoCompactionToSession(session: SessionHandle): Promise<void> {
    if (!session.setAutoCompactionEnabled) {
      return;
    }
    const resolved = await this.resolveAutoCompaction(session.id);
    session.setAutoCompactionEnabled(resolved.enabled);
  }

  private async handleMergeSubagent(
    requestId: string | undefined,
    childSessionId: string,
    force: boolean,
  ): Promise<HostResponse> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const child = await getSessionRecord(indexPath, childSessionId);
    if (!child) {
      return fail(requestId, 'session/merge-subagent', `Unknown session: ${childSessionId}`);
    }
    if (child.kind !== 'subagent' || !child.parentSessionId) {
      return fail(requestId, 'session/merge-subagent', 'session is not a sub-agent with parent');
    }
    const parentSessionId = child.parentSessionId;
    const parent = await getSessionRecord(indexPath, parentSessionId);
    if (!parent) {
      return fail(requestId, 'session/merge-subagent', `Unknown parent session: ${parentSessionId}`);
    }

    const prior = this.mergeLocks.get(parentSessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.mergeLocks.set(parentSessionId, prior.then(() => gate));
    await prior;

    try {
      // Re-read after lock for idempotency.
      const latestChild = await getSessionRecord(indexPath, childSessionId);
      if (!latestChild) {
        return fail(requestId, 'session/merge-subagent', `Unknown session: ${childSessionId}`);
      }
      if (latestChild.mergedAt && latestChild.mergeMessageId && !force) {
        return ok(requestId, 'session/merge-subagent', {
          childSessionId,
          parentSessionId,
          messageId: latestChild.mergeMessageId,
          alreadyMerged: true,
        });
      }

      const childMessages = await listTranscriptMessages(
        getPiwinSessionTranscriptPath(rootDir, childSessionId),
      );
      const summaryInput: Parameters<typeof buildSubagentMergeSummary>[0] = {
        status: latestChild.subagentStatus ?? 'done',
        messages: childMessages,
      };
      if (latestChild.task) summaryInput.task = latestChild.task;
      if (latestChild.name) summaryInput.name = latestChild.name;
      const summary = buildSubagentMergeSummary(summaryInput);
      const messageId = randomUUID();
      const cardText = formatSubagentMergeCard({
        summaryText: summary.summaryText,
        childSessionId,
      });
      const now = new Date().toISOString();
      await appendTranscriptMessage(
        getPiwinSessionTranscriptPath(rootDir, parentSessionId),
        parentSessionId,
        parent.projectPath,
        {
          id: messageId,
          role: 'system',
          text: cardText,
          createdAt: now,
          status: 'done',
        },
      );

      latestChild.mergedAt = now;
      latestChild.mergeMessageId = messageId;
      latestChild.summaryPreview = summary.preview;
      latestChild.updatedAt = now;
      if (
        !latestChild.subagentStatus ||
        latestChild.subagentStatus === 'running'
      ) {
        latestChild.subagentStatus = 'done';
      }
      await upsertSessionRecord(indexPath, latestChild);

      this.push({
        type: 'subagent/merged',
        parentSessionId,
        childSessionId,
        messageId,
      });
      this.push({
        type: 'subagent/updated',
        parentSessionId,
        child: indexRecordToSummary(latestChild),
      });
      this.push({
        type: 'host/log',
        level: 'info',
        message: `merged subagent ${childSessionId} into parent ${parentSessionId} (${summary.preview.length} preview chars)`,
      });

      return ok(requestId, 'session/merge-subagent', {
        childSessionId,
        parentSessionId,
        messageId,
        alreadyMerged: false,
        summaryPreview: summary.preview,
      });
    } finally {
      release();
    }
  }

  private ensureTranscriptRecorder(sessionId: string, projectPath: string): void {
    if (this.transcriptRecorders.has(sessionId)) {
      return;
    }
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const transcriptPath = getPiwinSessionTranscriptPath(rootDir, sessionId);
    this.transcriptRecorders.set(
      sessionId,
      createTranscriptRecorder({
        transcriptPath,
        sessionId,
        projectPath,
      }),
    );
  }

  private async recordUserPrompt(sessionId: string, input: PromptInput): Promise<void> {
    const projectPath = this.sessionProjects.get(sessionId) ?? 'unknown';
    this.ensureTranscriptRecorder(sessionId, projectPath);
    const recorder = this.transcriptRecorders.get(sessionId);
    if (recorder) {
      await recorder.recordUserPrompt(input);
    }
  }

  private async loadTranscriptMessages(
    sessionId: string,
  ): Promise<SessionTranscriptMessage[]> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const transcriptPath = getPiwinSessionTranscriptPath(rootDir, sessionId);
    return listTranscriptMessages(transcriptPath);
  }

  private async touchSession(sessionId: string, preview: string): Promise<void> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const current = await getSessionRecord(indexPath, sessionId);
    if (current) {
      current.updatedAt = new Date().toISOString();
      current.messageCount += 1;
      current.lastPreview = preview.slice(0, 160);
      await upsertSessionRecord(indexPath, current);
      return;
    }
    const projectPath = this.sessionProjects.get(sessionId) ?? 'unknown';
    const record = createSessionRecord({
      id: sessionId,
      projectPath,
      name: `session-${sessionId.slice(0, 8)}`,
    });
    record.messageCount = 1;
    record.lastPreview = preview.slice(0, 160);
    await upsertSessionRecord(indexPath, record);
  }

  private async ensureLiveSession(sessionId: string): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
    if (!record) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    const messages = await this.loadTranscriptMessages(sessionId);
    const executionMode = this.sessionExecutionModes.get(sessionId) ?? 'agent';
    try {
      const session = await this.host.resumeSession(sessionId);
      await this.bindSession(session, record.projectPath, record.name);
      return session;
    } catch {
      const shellOptions: Parameters<typeof createProductShellSession>[0] = {
        sessionId,
        projectPath: record.projectPath,
        seedMessages: messages,
        createLiveSession: async (input) => {
          const createInput = { ...input, executionMode };
          return this.host.createSession(createInput);
        },
      };
      if (record.name) {
        shellOptions.sessionName = record.name;
      }
      const shell = createProductShellSession(shellOptions);
      await this.bindSession(shell, record.projectPath, record.name);
      return shell;
    }
  }

  private async maybeEmitUsageOnMessageEnd(
    sessionId: string,
    messageId: string,
  ): Promise<void> {
    const existing = this.sessionUsage.get(sessionId);
    if (existing && existing.updatedAt) {
      const ageMs = Date.now() - Date.parse(existing.updatedAt);
      if (Number.isFinite(ageMs) && ageMs < 2000) {
        return;
      }
    }
    try {
      const messages = await this.loadTranscriptMessages(sessionId);
      const message = messages.find((item) => item.id === messageId);
      if (!message || message.role !== 'assistant') {
        return;
      }
      const promptText = this.sessionLastPromptText.get(sessionId) ?? '';
      const usage = estimateMockUsage(sessionId, promptText, message.text);
      this.sessionUsage.set(sessionId, usage);
      this.push({
        type: 'event',
        sessionId,
        event: { type: 'usage/update', sessionId, usage },
      });
    } catch {
      // best-effort
    }
  }

  private requireSession(sessionId: string): SessionHandle {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private push(message: HostPush): void {
    if (this.options.onPush) {
      this.options.onPush(message);
    }
  }
}

function ok(id: string | undefined, command: string, data?: unknown): HostResponse {
  if (id === undefined) {
    return { type: 'response', command, success: true, data };
  }
  return { id, type: 'response', command, success: true, data };
}

function fail(id: string | undefined, command: string, error: string): HostResponse {
  if (id === undefined) {
    return { type: 'response', command, success: false, error };
  }
  return { id, type: 'response', command, success: false, error };
}

function decodeBase64Media(base64Data: string): Uint8Array {
  const normalized = base64Data.replace(/\s/g, '');
  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error('media payload must be valid base64');
  }

  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.byteLength === 0) {
    throw new Error('media payload is empty');
  }
  return bytes;
}

function validateMediaAttachment(
  mediaRoot: string,
  attachment: MediaAttachmentRef,
): MediaAttachmentRef {
  const path = assertInsideMediaRoot(mediaRoot, attachment.path);
  const safeAttachment: MediaAttachmentRef = {
    id: attachment.id,
    path,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
    source: attachment.source,
  };
  if (attachment.width !== undefined) {
    safeAttachment.width = attachment.width;
  }
  if (attachment.height !== undefined) {
    safeAttachment.height = attachment.height;
  }
  return safeAttachment;
}

/**
 * Extract MCP server id from permission detail strings produced by the session bridge.
 * - mcp:connect  → "<serverId>: <command>"
 * - mcp:tool-call → "<serverId>/<toolName>"
 */
function parseMcpServerIdFromPermissionDetail(
  action: string,
  detail: string,
): string | null {
  const trimmed = detail.trim();
  if (!trimmed) {
    return null;
  }
  if (action === 'mcp:tool-call') {
    const slashIndex = trimmed.indexOf('/');
    return (slashIndex === -1 ? trimmed : trimmed.slice(0, slashIndex)).trim() || null;
  }
  const colonIndex = trimmed.indexOf(':');
  return (colonIndex === -1 ? trimmed : trimmed.slice(0, colonIndex)).trim() || null;
}


function indexRecordToSummary(record: {
  id: string;
  projectPath: string;
  name?: string;
  updatedAt: string;
  messageCount: number;
  lastPreview?: string;
  parentSessionId?: string;
  depth?: number;
  kind?: 'main' | 'subagent';
  subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled';
  task?: string;
  mergedAt?: string;
  mergeMessageId?: string;
  summaryPreview?: string;
  isPinned?: boolean;
  pinnedAt?: string;
}): import('@piwin/contracts').SessionSummary {
  const summary: import('@piwin/contracts').SessionSummary = {
    id: record.id,
    projectPath: record.projectPath,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
  };
  if (record.name) summary.name = record.name;
  if (record.lastPreview) summary.lastPreview = record.lastPreview;
  if (record.parentSessionId) summary.parentSessionId = record.parentSessionId;
  if (typeof record.depth === 'number') summary.depth = record.depth;
  if (record.kind) summary.kind = record.kind;
  if (record.subagentStatus) summary.subagentStatus = record.subagentStatus;
  if (record.task) summary.task = record.task;
  if (record.mergedAt) summary.mergedAt = record.mergedAt;
  if (record.mergeMessageId) summary.mergeMessageId = record.mergeMessageId;
  if (record.summaryPreview) summary.summaryPreview = record.summaryPreview;
  if (record.isPinned === true) summary.isPinned = true;
  if (record.pinnedAt) summary.pinnedAt = record.pinnedAt;
  return summary;
}

function resolveExecutionMode(mode: ExecutionMode | undefined): ExecutionMode {
  if (mode === 'chat' || mode === 'agent' || mode === 'agent-debug') {
    return mode;
  }
  return 'agent';
}
