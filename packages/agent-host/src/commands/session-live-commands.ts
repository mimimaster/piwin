import { randomUUID } from 'node:crypto';
/**
 * Live session IPC: create/spawn/prompt/compact/export and sub-agent lifecycle.
 * HostRuntime provides SessionLiveContext (maps + ensureLiveSession/bindSession/…).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import type {
  AgentHost,
  CreateSessionInput,
  ExecutionMode,
  HostCommand,
  HostPush,
  HostResponse,
  PromptInput,
  SessionHandle,
  SessionResumeData,
  SessionRunAcceptedData,
  SessionRunOutcome,
  SessionRunPhase,
  SessionRunTerminalCode,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import type { ActiveRun } from '../active-run.js';
import { createWorktree, removeWorktree, applyWorktreeToMain } from '@piwin/git';
import {
  appendTranscriptMessage,
  buildSessionOutline,
  buildProductHistoryContext,
  buildSubagentActivityView,
  buildSubagentMergeSummary,
  clearSessionPlan,
  createSessionRecord,
  exportTranscript,
  formatSubagentActivityText,
  formatSubagentMergeCard,
  getSessionRecord,
  listChildSessions,
  listTranscriptMessages,
  loadSessionPlan,
  mergeProductHistoryIntoPrompt,
  saveSessionPlan,
  suggestSessionExportBasename,
  truncateTranscriptFrom,
  upsertSessionRecord,
} from '@piwin/session';
import {
  extractFileOpsFromUnknown,
  formatFilesTouchedBlock,
} from '../compaction-file-ops.js';
import { formatPlanForModelContext } from '../format-plan-context.js';
import { createProductShellSession } from '../product-shell-session.js';
import { resolveExecutionMode } from '../execution-mode.js';
import { fail, ok } from '../response-helpers.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionIndexPath,
  getPiwinSessionPlanPath,
  getPiwinSessionTranscriptPath,
} from '../paths.js';
import type { createTranscriptRecorder } from '../transcript-recorder.js';
import {
  indexProjectPathForScope,
  resolveSessionLocation,
  scopeFromIndexRecord,
} from '../session-scope.js';

export type SessionLiveContext = {
  piwinRoot?: string;
  host: AgentHost;
  /** HostRuntime-owned creation seam for explicit integration fixtures. */
  createSession: (input: CreateSessionInput) => Promise<SessionHandle>;
  sessions: Map<string, SessionHandle>;
  sessionExecutionModes: Map<string, ExecutionMode>;
  sessionFilesTouched: Map<string, string>;
  sessionLastPromptText: Map<string, string>;
  sessionAutoCompactionOverrides: Map<string, boolean>;
  unsubscribers: Map<string, () => void>;
  transcriptRecorders: Map<string, ReturnType<typeof createTranscriptRecorder>>;
  push: (message: HostPush) => void;
  pushStatus: () => void;
  requireSession: (sessionId: string) => SessionHandle;
  bindSession: (
    session: SessionHandle,
    projectPath?: string,
    sessionName?: string,
    lineage?: {
      parentSessionId?: string;
      kind?: 'main' | 'subagent';
      depth?: number;
      subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled';
      task?: string;
      subagentMode?: 'readonly' | 'worktree';
      subagentApplyPolicy?: 'none' | 'auto' | 'explicit';
      subagentAllowedOutputPaths?: string[];
      subagentRetainWorktree?: boolean;
      subagentRole?: string;
      worktreePath?: string;
      worktreeBranch?: string;
    },
  ) => Promise<void>;
  loadTranscriptMessages: (sessionId: string) => Promise<SessionTranscriptMessage[]>;
  stopProcessesForSession: (sessionId: string) => Promise<void>;
  recordUserPrompt: (sessionId: string, input: PromptInput) => Promise<void>;
  touchSession: (sessionId: string, previewText: string) => Promise<void>;
  needsProductHistoryInjection: (sessionId: string) => boolean;
  ensureLiveSession: (sessionId: string) => Promise<SessionHandle>;
  resolveAutoCompaction: (
    sessionId: string,
  ) => Promise<{ enabled: boolean; source: string; globalDefault: boolean }>;
  maybeInjectMemoryOverview: (sessionId: string, text: string) => Promise<string>;
  handleMergeSubagent: (
    requestId: string | undefined,
    childSessionId: string,
    force: boolean,
  ) => Promise<HostResponse>;
  buildModelPromptInput: (input: PromptInput) => PromptInput;
  runWithContext: (runId: string, operation: () => Promise<void>) => void;
  /** ADR 0015: foreground run lifecycle. */
  getActiveRun: (sessionId: string) => ActiveRun | undefined;
  registerActiveRun: (sessionId: string) => ActiveRun;
  requestCancelActiveRun: (sessionId: string, runId?: string) => ActiveRun | undefined;
  markActiveRunTerminal: (sessionId: string, runId: string) => boolean;
  clearActiveRun: (sessionId: string, runId?: string) => ActiveRun | undefined;
  emitRunPhase: (
    sessionId: string,
    runId: string,
    phase: SessionRunPhase,
    detail?: string,
  ) => void;
  emitRunTerminal: (
    sessionId: string,
    runId: string,
    outcome: SessionRunOutcome,
    code?: SessionRunTerminalCode,
    message?: string,
  ) => boolean;
  settlePendingPermissionsForSession: (sessionId: string) => void;
};

const TYPES = new Set<HostCommand['type']>([
  'session/create',
  'session/spawn',
  'session/list-children',
  'session/cancel-subagent',
  'session/complete-subagent',
  'session/merge-subagent',
  'session/truncate-from',
  'session/resume',
  'session/messages',
  'session/prompt',
  'session/abort',
  'session/steer',
  'session/follow_up',
  'session/compact',
  'session/compact-abort',
  'session/compaction-settings',
  'session/set-auto-compaction',
  'session/export',
  'session/message-child',
]);

export function isSessionLiveCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

type PromptCommand = Extract<HostCommand, { type: 'session/prompt' }>;

class PromptPreparationCancelledError extends Error {
  constructor() {
    super('prompt preparation cancelled');
    this.name = 'PromptPreparationCancelledError';
  }
}

function throwIfPromptPreparationAborted(run: ActiveRun): void {
  if (run.abortController.signal.aborted) {
    throw new PromptPreparationCancelledError();
  }
}

async function preparePromptInput(
  context: SessionLiveContext,
  command: PromptCommand,
  run: ActiveRun,
): Promise<PromptInput> {
  throwIfPromptPreparationAborted(run);

  // Persist original user text + attachments before path-injection rewrite.
  try {
    await context.recordUserPrompt(command.sessionId, command.input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `transcript user write failed: ${message}`,
    });
  }
  throwIfPromptPreparationAborted(run);

  const promptInput = context.buildModelPromptInput(command.input);
  throwIfPromptPreparationAborted(run);

  // A continuous Pi SDK session keeps native context itself. Inject product
  // history only when a recovered Product Shell is about to create its first
  // live handle, otherwise the model receives the same prior turns twice.
  if (context.needsProductHistoryInjection(command.sessionId)) {
    try {
      const transcriptMessages = await context.loadTranscriptMessages(command.sessionId);
      throwIfPromptPreparationAborted(run);
      const lastMessageId = transcriptMessages[transcriptMessages.length - 1]?.id;
      const history = buildProductHistoryContext(
        transcriptMessages,
        lastMessageId ? { excludeMessageId: lastMessageId } : {},
      );
      if (history) {
        promptInput.text = mergeProductHistoryIntoPrompt(history, promptInput.text);
      }
    } catch (error) {
      if (error instanceof PromptPreparationCancelledError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `product history inject failed: ${message}`,
      });
    }
  }
  throwIfPromptPreparationAborted(run);

  const planPath = getPiwinSessionPlanPath(
    getPiwinRoot(context.piwinRoot),
    command.sessionId,
  );
  const activePlan = await loadSessionPlan(planPath);
  throwIfPromptPreparationAborted(run);
  if (
    activePlan &&
    (activePlan.status === 'approved' || activePlan.status === 'executing')
  ) {
    promptInput.text = `${formatPlanForModelContext(activePlan)}\n\n${promptInput.text}`;
  }

  try {
    promptInput.text = await context.maybeInjectMemoryOverview(
      command.sessionId,
      promptInput.text,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `memory overview inject failed: ${message}`,
    });
  }
  throwIfPromptPreparationAborted(run);

  const filesTouched = context.sessionFilesTouched.get(command.sessionId);
  if (filesTouched) {
    promptInput.text = `${filesTouched}\n\n${promptInput.text}`;
  }
  context.sessionLastPromptText.set(command.sessionId, command.input.text);
  throwIfPromptPreparationAborted(run);
  return promptInput;
}

export async function handleSessionLiveCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionLiveContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
        case 'session/create': {
          let createInput = command.input;
          try {
            const location = await resolveSessionLocation(command.input, context.piwinRoot);
            createInput = {
              ...command.input,
              scope: location.scope,
              // Index field: empty for general. Adapters re-resolve workingDirectory.
              projectPath: indexProjectPathForScope(location.scope),
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return fail(requestId, 'session/create', message);
          }
          const session = await context.createSession(createInput);
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
          context.sessionExecutionModes.set(session.id, executionMode);
          await context.bindSession(
            session,
            createInput.projectPath,
            command.input.sessionName,
            lineage,
          );
          context.pushStatus();
          return ok(requestId, 'session/create', {
            sessionId: session.id,
            executionMode,
          });
        }
        case 'session/spawn': {
          const rootDir = getPiwinRoot(context.piwinRoot);
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
          const mode: import('@piwin/contracts').SubagentIsolationMode =
            command.mode === 'worktree' ? 'worktree' : 'readonly';
          const applyPolicy: import('@piwin/contracts').SubagentApplyPolicy =
            command.applyPolicy === 'auto' || command.applyPolicy === 'explicit'
              ? command.applyPolicy
              : 'none';
          const retainWorktree = command.retainWorktree === true;
          let worktreePath: string | undefined;
          let worktreeBranch: string | undefined;
          if (mode === 'worktree') {
            const wt = await createWorktree({
              projectPath: parent.projectPath,
              name: `child-${Date.now().toString(36)}`,
            });
            worktreePath = wt.worktreePath;
            worktreeBranch = wt.branch;
          }
          const subagent: import('@piwin/contracts').SubagentSpawnOptions = {
            mode,
            applyPolicy,
            retainWorktree,
            ...(command.allowedOutputPaths ? { allowedOutputPaths: command.allowedOutputPaths } : {}),
            ...(command.role ? { role: command.role } : {}),
          };
          const child = await context.createSession({
            projectPath: parent.projectPath,
            sessionName: childName,
            parentSessionId: parent.id,
            task,
            subagent,
            ...(worktreePath ? { cwd: worktreePath } : {}),
          });
          await context.bindSession(child, parent.projectPath, childName, {
            parentSessionId: parent.id,
            kind: 'subagent',
            depth: 1,
            subagentStatus: 'running',
            task,
            subagentMode: mode,
            subagentApplyPolicy: applyPolicy,
            subagentRetainWorktree: retainWorktree,
            ...(command.allowedOutputPaths
              ? { subagentAllowedOutputPaths: command.allowedOutputPaths }
              : {}),
            ...(command.role ? { subagentRole: command.role } : {}),
            ...(worktreePath ? { worktreePath } : {}),
            ...(worktreeBranch ? { worktreeBranch } : {}),
          });
          // Seed task into child session (best-effort).
          try {
            const seed =
              mode === 'readonly'
                ? `[READONLY sub-agent] Do not modify files or run destructive commands.\n\n${task}`
                : mode === 'worktree'
                  ? `[WORKTREE sub-agent] Work only under ${worktreePath}.\n\n${task}`
                  : task;
            await context.recordUserPrompt(child.id, { text: seed });
            await child.prompt({ text: seed });
            await context.touchSession(child.id, task);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            context.push({
              type: 'host/log',
              level: 'warn',
              message: `subagent seed prompt failed: ${message}`,
            });
          }
          await recordParentSubagentActivity(context, parent.id, {
            childSessionId: child.id,
            displayName: childName,
            task,
            status: 'running',
            ...(worktreePath ? { worktreePath } : {}),
          });
          context.pushStatus();
          return ok(requestId, 'session/spawn', {
            sessionId: child.id,
            parentSessionId: parent.id,
            mode,
            applyPolicy,
            ...(worktreePath ? { worktreePath } : {}),
          });
        }
        case 'session/list-children': {
          const rootDir = getPiwinRoot(context.piwinRoot);
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
          const rootDir = getPiwinRoot(context.piwinRoot);
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
          const live = context.sessions.get(command.sessionId);
          if (live) {
            try {
              await live.abort();
            } catch {
              // ignore abort errors
            }
          }
          await context.stopProcessesForSession(command.sessionId);
          record.subagentStatus = 'cancelled';
          record.updatedAt = new Date().toISOString();
          await upsertSessionRecord(indexPath, record);
          if (record.parentSessionId) {
            await recordParentSubagentActivity(context, record.parentSessionId, {
              childSessionId: record.id,
              status: 'cancelled',
              ...(record.name ? { displayName: record.name } : {}),
              ...(record.task ? { task: record.task } : {}),
              ...(record.worktreePath ? { worktreePath: record.worktreePath } : {}),
            });
          }
          return ok(requestId, 'session/cancel-subagent', {
            sessionId: command.sessionId,
            status: 'cancelled',
          });
        }
        case 'session/complete-subagent': {
          const rootDir = getPiwinRoot(context.piwinRoot);
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
          const live = context.sessions.get(command.sessionId);
          if (live) {
            try {
              await live.abort();
            } catch {
              // ignore abort errors
            }
          }
          await context.stopProcessesForSession(command.sessionId);
          const nextStatus = command.status === 'failed' ? 'failed' : 'done';
          record.subagentStatus = nextStatus;
          record.updatedAt = new Date().toISOString();
          // CE-SUB apply policies when completing successfully
          if (
            nextStatus === 'done' &&
            record.subagentMode === 'worktree' &&
            record.worktreePath &&
            record.subagentApplyPolicy &&
            record.subagentApplyPolicy !== 'none'
          ) {
            try {
              const applied = await applyWorktreeToMain({
                projectPath: record.projectPath,
                worktreePath: record.worktreePath,
                ...(record.subagentApplyPolicy === 'explicit' &&
                record.subagentAllowedOutputPaths
                  ? { allowedOutputPaths: record.subagentAllowedOutputPaths }
                  : {}),
              });
              context.push({
                type: 'host/log',
                level: 'info',
                message: `subagent apply ${applied.strategy}: ${applied.appliedPaths.join(', ') || '(none)'}`,
              });
              if (record.subagentRetainWorktree !== true) {
                await removeWorktree({
                  projectPath: record.projectPath,
                  worktreePath: record.worktreePath,
                  force: true,
                });
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              context.push({
                type: 'host/log',
                level: 'warn',
                message: `subagent apply/cleanup failed: ${message}`,
              });
            }
          }
          await upsertSessionRecord(indexPath, record);
          if (record.parentSessionId) {
            await recordParentSubagentActivity(context, record.parentSessionId, {
              childSessionId: record.id,
              status: nextStatus,
              ...(record.name ? { displayName: record.name } : {}),
              ...(record.task ? { task: record.task } : {}),
              ...(record.worktreePath ? { worktreePath: record.worktreePath } : {}),
            });
          }
          context.push({
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
          return context.handleMergeSubagent(requestId, command.childSessionId, command.force === true);
        }

        case 'session/truncate-from': {
          const rootDir = getPiwinRoot(context.piwinRoot);
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
          const live = context.sessions.get(command.sessionId);
          if (live) {
            try {
              await live.abort();
            } catch {
              // ignore
            }
            const unsub = context.unsubscribers.get(command.sessionId);
            if (unsub) {
              unsub();
              context.unsubscribers.delete(command.sessionId);
            }
            context.transcriptRecorders.delete(command.sessionId);
            context.sessions.delete(command.sessionId);
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
          const rootDir = getPiwinRoot(context.piwinRoot);
          const existing = await getSessionRecord(
            getPiwinSessionIndexPath(rootDir),
            command.sessionId,
          );
          if (!existing) {
            return fail(requestId, 'session/resume', `Unknown session: ${command.sessionId}`);
          }
          const messages = await context.loadTranscriptMessages(command.sessionId);
          let session: SessionHandle;
          let live = true;
          try {
            session = await context.host.resumeSession(command.sessionId);
          } catch (error) {
            // Cross-process: adapter may not hold the Pi handle. Bind a product shell
            // that keeps stable id + transcript and creates a live session on first prompt.
            const message = error instanceof Error ? error.message : String(error);
            context.push({
              type: 'host/log',
              level: 'info',
              message: `resume fallback to product shell: ${message}`,
            });
            const shellOptions: Parameters<typeof createProductShellSession>[0] = {
              sessionId: command.sessionId,
              projectPath: existing.projectPath,
              seedMessages: messages,
              createLiveSession: async (input: CreateSessionInput) => context.createSession(input),
            };
            if (existing.name) {
              shellOptions.sessionName = existing.name;
            }
            session = createProductShellSession(shellOptions);
            live = true;
          }
          await context.bindSession(session, existing.projectPath, existing.name);
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
          const messages = await context.loadTranscriptMessages(command.sessionId);
          return ok(requestId, 'session/messages', {
            sessionId: command.sessionId,
            messages,
          });
        }
        case 'session/prompt': {
          // ADR 0015: one foreground run per session; reject concurrent prompts.
          if (context.getActiveRun(command.sessionId)) {
            return fail(
              requestId,
              'session/prompt',
              `run-active: session ${command.sessionId} already has a foreground run`,
            );
          }

          // Validate the session before registering ownership. Everything after
          // this point is tracked preparation and must not delay the ack.
          try {
            context.requireSession(command.sessionId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return fail(requestId, 'session/prompt', message);
          }
          // Validate synchronous security-sensitive input before accepting the
          // run. Preparation may move to the background, but invalid media
          // paths must still fail the request instead of becoming an async
          // terminal error after the UI has shown an accepted run.
          try {
            context.buildModelPromptInput(command.input);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return fail(requestId, 'session/prompt', message);
          }
          let run: ActiveRun;
          try {
            run = context.registerActiveRun(command.sessionId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return fail(requestId, 'session/prompt', message);
          }

          const acceptedAt = new Date().toISOString();
          context.emitRunPhase(command.sessionId, run.runId, 'accepted');
          context.emitRunPhase(command.sessionId, run.runId, 'preparing');

          // Preparation and the provider turn are deliberately detached from the
          // request path. runWithContext owns the async context, while this
          // callback owns the run's single terminal transition.
          context.runWithContext(run.runId, async () => {
            try {
              const promptInput = await preparePromptInput(context, command, run);
              if (run.abortController.signal.aborted) {
                context.emitRunTerminal(
                  command.sessionId,
                  run.runId,
                  'cancelled',
                  'cancelled',
                );
                return;
              }

              // Ensure a live session exists after truncate (product shell rebuild).
              const liveSession = await context.ensureLiveSession(command.sessionId);
              if (run.abortController.signal.aborted) {
                context.emitRunTerminal(
                  command.sessionId,
                  run.runId,
                  'cancelled',
                  'cancelled',
                );
                return;
              }

              await liveSession.prompt(promptInput);
              if (run.abortController.signal.aborted) {
                context.emitRunTerminal(
                  command.sessionId,
                  run.runId,
                  'cancelled',
                  'cancelled',
                );
                return;
              }
              context.emitRunTerminal(command.sessionId, run.runId, 'completed');
              try {
                await context.touchSession(command.sessionId, command.input.text);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                context.push({
                  type: 'host/log',
                  level: 'warn',
                  message: `session index touch failed: ${message}`,
                });
              }
            } catch (error) {
              if (run.abortController.signal.aborted) {
                context.emitRunTerminal(
                  command.sessionId,
                  run.runId,
                  'cancelled',
                  'cancelled',
                );
                return;
              }
              const message = error instanceof Error ? error.message : String(error);
              context.emitRunTerminal(
                command.sessionId,
                run.runId,
                'failed',
                undefined,
                message,
              );
              context.push({
                type: 'event',
                sessionId: command.sessionId,
                event: { type: 'error', message, retriable: true, runId: run.runId },
              });
            }
          });

          const accepted: SessionRunAcceptedData = {
            sessionId: command.sessionId,
            runId: run.runId,
            acceptedAt,
          };
          return ok(requestId, 'session/prompt', accepted);
        }
        case 'session/abort': {
          const requestedRunId =
            'runId' in command && typeof command.runId === 'string'
              ? command.runId
              : undefined;
          const active = context.getActiveRun(command.sessionId);
          if (!active) {
            // Idempotent: no active run to cancel. Cleanup is best-effort and
            // deliberately detached so a stale control request stays quick.
            scheduleAbortCleanup(context, command.sessionId);
            return ok(requestId, 'session/abort', {
              sessionId: command.sessionId,
              cancelled: false,
              reason: 'no-active-run',
            });
          }
          if (requestedRunId !== undefined && active.runId !== requestedRunId) {
            return ok(requestId, 'session/abort', {
              sessionId: command.sessionId,
              cancelled: false,
              reason: 'run-mismatch',
              activeRunId: active.runId,
            });
          }

          context.emitRunPhase(command.sessionId, active.runId, 'cancelling');
          const cancellationRequested = context.requestCancelActiveRun(
            command.sessionId,
            active.runId,
          );
          if (!cancellationRequested) {
            return ok(requestId, 'session/abort', {
              sessionId: command.sessionId,
              cancelled: false,
              reason: 'no-active-run',
            });
          }
          context.settlePendingPermissionsForSession(command.sessionId);

          // The background prompt owns terminal confirmation. Neither provider
          // abort nor process cleanup is allowed to delay this acknowledgement.
          scheduleAbortCleanup(context, command.sessionId);

          return ok(requestId, 'session/abort', {
            sessionId: command.sessionId,
            runId: active.runId,
            cancelled: true,
          });
        }
        case 'session/steer': {
          const active = context.getActiveRun(command.sessionId);
          if (!active) {
            return fail(
              requestId,
              'session/steer',
              `no-active-run: session ${command.sessionId} has no foreground run`,
            );
          }
          if (command.runId !== undefined && command.runId !== active.runId) {
            return fail(
              requestId,
              'session/steer',
              `run-mismatch: requested ${command.runId}, active ${active.runId}`,
            );
          }
          await context.requireSession(command.sessionId).steer(command.message);
          return ok(requestId, 'session/steer', {
            sessionId: command.sessionId,
            runId: active.runId,
          });
        }
        case 'session/follow_up': {
          const active = context.getActiveRun(command.sessionId);
          if (!active) {
            return fail(
              requestId,
              'session/follow_up',
              `no-active-run: session ${command.sessionId} has no foreground run`,
            );
          }
          // Follow-up starts work through the live session, so it must carry
          // an explicit owner. This prevents events from an unowned request
          // being correlated with whichever run happens to be current later.
          if (command.runId !== active.runId) {
            return fail(
              requestId,
              'session/follow_up',
              `run-mismatch: requested ${command.runId ?? '<missing>'}, active ${active.runId}`,
            );
          }
          await context.requireSession(command.sessionId).followUp(command.message);
          return ok(requestId, 'session/follow_up', {
            sessionId: command.sessionId,
            runId: active.runId,
          });
        }
        case 'session/compact': {
          const session = context.requireSession(command.sessionId);
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
            fileOps?: import('@piwin/contracts').CompactionFileOps;
          } = { ok: result.ok, durationMs };
          if (result.message) data.message = result.message;
          if (result.summary) data.summary = result.summary;
          if (typeof result.tokensBefore === 'number') data.tokensBefore = result.tokensBefore;
          if (typeof result.tokensAfter === 'number') data.tokensAfter = result.tokensAfter;
          const fileOps =
            result.fileOps ??
            extractFileOpsFromUnknown(result) ??
            extractFileOpsFromUnknown({ summary: result.summary });
          if (fileOps) {
            data.fileOps = fileOps;
            const block = formatFilesTouchedBlock(fileOps);
            context.sessionFilesTouched.set(command.sessionId, block);
            context.push({
              type: 'event',
              sessionId: command.sessionId,
              event: {
                type: 'compaction/end',
                ok: result.ok,
                ...(result.message ? { message: result.message } : {}),
                ...(result.summary ? { summary: result.summary } : {}),
                ...(typeof result.tokensBefore === 'number'
                  ? { tokensBefore: result.tokensBefore }
                  : {}),
                ...(typeof result.tokensAfter === 'number'
                  ? { tokensAfter: result.tokensAfter }
                  : {}),
                durationMs,
                fileOps,
              },
            });
          }
          return ok(requestId, 'session/compact', data);
        }
        case 'session/compact-abort': {
          const session = context.requireSession(command.sessionId);
          if (session.abortCompaction) {
            session.abortCompaction();
          }
          return ok(requestId, 'session/compact-abort', { sessionId: command.sessionId });
        }
        case 'session/compaction-settings': {
          const session = context.requireSession(command.sessionId);
          const supported = typeof session.getAutoCompactionEnabled === 'function';
          const resolved = await context.resolveAutoCompaction(command.sessionId);
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
          const session = context.requireSession(command.sessionId);
          if (!session.setAutoCompactionEnabled) {
            return fail(
              requestId,
              'session/set-auto-compaction',
              'auto-compaction settings not supported on this session',
            );
          }
          context.sessionAutoCompactionOverrides.set(command.sessionId, command.enabled);
          session.setAutoCompactionEnabled(command.enabled);
          return ok(requestId, 'session/set-auto-compaction', {
            enabled: command.enabled,
            source: 'session' as const,
          });
        }




        case 'session/export': {
          const rootDir = getPiwinRoot(context.piwinRoot);
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
          const messages = await context.loadTranscriptMessages(command.sessionId);
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

        case 'session/message-child': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const indexPath = getPiwinSessionIndexPath(rootDir);
          const child = await getSessionRecord(indexPath, command.childSessionId);
          if (!child || child.parentSessionId !== command.parentSessionId) {
            return fail(requestId, 'session/message-child', 'Invalid parent/child relationship');
          }
          const text = command.text.trim();
          if (!text) {
            return fail(requestId, 'session/message-child', 'text is required');
          }
          const live = await context.ensureLiveSession(command.childSessionId);
          await context.recordUserPrompt(command.childSessionId, { text });
          await live.prompt({ text });
          return ok(requestId, 'session/message-child', {
            childSessionId: command.childSessionId,
          });
        }
    default:
      return null;
  }
}

/**
 * Start cancellation side effects without making the control response depend
 * on provider or process-manager latency. The foreground prompt remains the
 * only owner allowed to emit the run terminal event.
 */
function scheduleAbortCleanup(context: SessionLiveContext, sessionId: string): void {
  void Promise.all([
    abortLiveSession(context, sessionId),
    context.stopProcessesForSession(sessionId),
  ]).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `session abort cleanup failed: ${message}`,
    });
  });
}

async function abortLiveSession(context: SessionLiveContext, sessionId: string): Promise<void> {
  try {
    await context.requireSession(sessionId).abort();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `session abort failed: ${message}`,
    });
  }
}

async function recordParentSubagentActivity(
  context: {
    piwinRoot?: string;
    push: (message: HostPush) => void;
  },
  parentSessionId: string,
  input: {
    childSessionId: string;
    displayName?: string;
    task?: string;
    status?: string;
    merged?: boolean;
    worktreePath?: string;
  },
): Promise<void> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const parent = await getSessionRecord(indexPath, parentSessionId);
  if (!parent) {
    return;
  }
  const activity = buildSubagentActivityView({
    childSessionId: input.childSessionId,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.task ? { task: input.task } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.merged ? { merged: true } : {}),
    ...(input.worktreePath ? { worktreePath: input.worktreePath } : {}),
  });
  const messageId = randomUUID();
  const message: SessionTranscriptMessage = {
    id: messageId,
    role: 'system',
    text: formatSubagentActivityText(activity),
    createdAt: activity.updatedAt,
    status: 'done',
    subagentActivity: activity,
  };
  await appendTranscriptMessage(
    getPiwinSessionTranscriptPath(rootDir, parentSessionId),
    parentSessionId,
    parent.projectPath,
    message,
  );
  const child = await getSessionRecord(indexPath, input.childSessionId);
  if (child) {
    context.push({
      type: 'subagent/updated',
      parentSessionId,
      child: indexRecordToSummary(child),
    });
  }
  context.push({
    type: 'transcript/append',
    sessionId: parentSessionId,
    message,
  });
}
