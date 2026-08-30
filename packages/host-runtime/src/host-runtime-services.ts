/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { join } from 'node:path';
import type { AgentEvent, JobController } from '@piwin/contracts';
import { AgentWorkerSupervisor } from '@piwin/agent-host';
import { formatError, isRunTerminal } from '@piwin/contracts';
import { createMcpLifecycleManager, type McpLifecycleManager } from '@piwin/mcp';
import { type JobRegistryEvent } from '@piwin/process';
import {
  getCronStorePath,
  getHooksStorePath,
  loadHooks,
  runMatchingHooks,
  upsertCronJob,
} from '@piwin/automation';
import { getActivePet } from '@piwin/pet';
import { createPetStateStore, type PetStateStore } from './pet-state-store.js';
import type { PetRuntimeSnapshot } from '@piwin/contracts';

import { finalizeRunTranscriptArtifacts } from './transcript-stream-settler.js';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinRoot } from './paths.js';
import { fail, ok } from './response-helpers.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { fallbackPetSnapshot } from './pet-snapshot-fallback.js';
import { subagentInvocationActivityFromEvent } from './subagent-invocation-activity.js';

export async function getNotesServices(deps: HostRuntimeKernel): Promise<{
  store: import('@piwin/notes').NoteStore;
  index: import('@piwin/notes').NoteIndex;
  searchOptions: import('@piwin/notes').SearchNotesOptions;
}> {
  if (!deps.notesServices) {
    const rootDir = getPiwinRoot(deps.options.piwinRoot);
    const config = await loadPiwinConfig(rootDir);
    if (config.notes?.enabled === false) {
      throw new Error('Notes are disabled (config.notes.enabled=false).');
    }
    const { createNoteStore, openNoteIndex, createEmbeddingProvider } =
      await import('@piwin/notes');
    const { resolveNotesEmbeddingApiKey } = await import('./notes-embedding-secret.js');
    const store = createNoteStore({ piwinRoot: rootDir });
    const index = await openNoteIndex(store);
    const searchOptions: import('@piwin/notes').SearchNotesOptions = {};
    if (config.notes?.embedding) {
      const apiKey = await resolveNotesEmbeddingApiKey(config.notes.embedding);
      const provider = createEmbeddingProvider({
        config: config.notes.embedding,
        ...(apiKey ? { apiKey } : {}),
      });
      if (provider) searchOptions.embeddingProvider = provider;
    }
    if (typeof config.notes?.search?.rrfK === 'number') {
      searchOptions.rrfK = config.notes.search.rrfK;
    }
    const { buildNotesRerankProvider } = await import('./notes-rerank.js');
    const rerank = await buildNotesRerankProvider(config);
    if (rerank) {
      searchOptions.rerankProvider = rerank;
    }
    deps.notesServices = { store, index, searchOptions };
  }
  return deps.notesServices;
}

export async function getCardStore(
  deps: HostRuntimeKernel,
): Promise<import('@piwin/flashcards').CardStore> {
  if (!deps.cardStore) {
    const rootDir = getPiwinRoot(deps.options.piwinRoot);
    const config = await loadPiwinConfig(rootDir);
    if (config.flashcards?.enabled === false) {
      throw new Error('Flashcards are disabled (config.flashcards.enabled=false).');
    }
    const { createCardStore } = await import('@piwin/flashcards');
    deps.cardStore = createCardStore({ piwinRoot: rootDir });
  }
  return deps.cardStore;
}

export async function getStudyService(
  deps: HostRuntimeKernel,
): Promise<import('@piwin/flashcards').StudyService> {
  if (!deps.studyService) {
    const rootDir = getPiwinRoot(deps.options.piwinRoot);
    const config = await loadPiwinConfig(rootDir);
    if (config.flashcards?.enabled === false) {
      throw new Error('Flashcards are disabled (config.flashcards.enabled=false).');
    }
    const cardStore = await getCardStore(deps);
    const { createStudyService, getFlashcardsRoot, getOrCreateStudyCoordinator } =
      await import('@piwin/flashcards');
    const { toStudyChangedPush } = await import('./commands/flashcard-study-commands.js');
    const coordinator = getOrCreateStudyCoordinator(getFlashcardsRoot(rootDir), {
      onApplied: (event) => {
        deps.push(toStudyChangedPush(event));
      },
    });
    deps.studyService = createStudyService({ coordinator, cards: cardStore });
  }
  return deps.studyService;
}

export async function getFolderRag(
  deps: HostRuntimeKernel,
): Promise<import('@piwin/doc-rag').FolderRag> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const config = await loadPiwinConfig(rootDir);
  const mineruConfig = config.knowledge?.parser?.mineru;
  const unstructuredConfig = config.knowledge?.parser?.unstructured;
  const mineruEnabled = mineruConfig?.enabled === true && Boolean(mineruConfig.baseUrl?.trim());
  const unstructuredEnabled =
    unstructuredConfig?.enabled === true && Boolean(unstructuredConfig.baseUrl?.trim());
  const ragKey = JSON.stringify({
    mineruEnabled,
    mineruUrl: mineruConfig?.baseUrl ?? '',
    mineruRef: mineruConfig?.apiKeyRef ?? '',
    unstructuredEnabled,
    unstructuredUrl: unstructuredConfig?.baseUrl ?? '',
    unstructuredRef: unstructuredConfig?.apiKeyRef ?? '',
    embed: config.notes?.embedding?.model ?? '',
    rerank: config.knowledge?.reranker?.enabled === true,
    rerankUrl: config.knowledge?.reranker?.baseUrl ?? '',
  });
  if (deps.folderRag && deps.folderRagKey === ragKey) {
    return deps.folderRag;
  }
  if (deps.folderRag) {
    try {
      deps.folderRag.close();
    } catch {
      // recreate below
    }
    deps.folderRag = null;
  }
  const { createFolderRag, createHttpReranker, createParserRegistry } =
    await import('@piwin/doc-rag');
  const { createEmbeddingProvider } = await import('@piwin/notes');
  const { resolveKnowledgeHttpApiKey, resolveNotesEmbeddingApiKey } =
    await import('./notes-embedding-secret.js');
  let embeddingProvider: import('@piwin/contracts').EmbeddingProvider | undefined;
  if (config.notes?.embedding) {
    const apiKey = await resolveNotesEmbeddingApiKey(config.notes.embedding);
    const provider = createEmbeddingProvider({
      config: config.notes.embedding,
      ...(apiKey ? { apiKey } : {}),
    });
    if (provider) embeddingProvider = provider;
  }
  let reranker: import('@piwin/contracts').SharedReranker | undefined;
  const rerankConfig = config.knowledge?.reranker;
  if (rerankConfig?.enabled === true && rerankConfig.baseUrl && rerankConfig.model) {
    const apiKey = await resolveKnowledgeHttpApiKey(rerankConfig);
    reranker = createHttpReranker({
      providerId: rerankConfig.provider ?? 'openai-compatible',
      modelId: rerankConfig.model,
      baseUrl: rerankConfig.baseUrl,
      ...(apiKey ? { apiKey } : {}),
      ...(typeof rerankConfig.topK === 'number' ? { topK: rerankConfig.topK } : {}),
      ...(typeof rerankConfig.timeoutMs === 'number' ? { timeoutMs: rerankConfig.timeoutMs } : {}),
    });
  }
  const mineruKey = mineruEnabled ? await resolveKnowledgeHttpApiKey(mineruConfig) : undefined;
  const unstructuredKey = unstructuredEnabled
    ? await resolveKnowledgeHttpApiKey(unstructuredConfig)
    : undefined;
  deps.folderRag = createFolderRag({
    piwinRoot: rootDir,
    ...(embeddingProvider ? { embeddingProvider } : {}),
    ...(reranker ? { reranker } : {}),
    parserRegistry: createParserRegistry({
      mineruEnabled,
      unstructuredEnabled,
      ...(mineruEnabled && mineruConfig?.baseUrl
        ? {
            mineru: {
              baseUrl: mineruConfig.baseUrl,
              ...(mineruKey ? { apiKey: mineruKey } : {}),
              ...(typeof mineruConfig.timeoutMs === 'number'
                ? { timeoutMs: mineruConfig.timeoutMs }
                : {}),
            },
          }
        : {}),
      ...(unstructuredEnabled && unstructuredConfig?.baseUrl
        ? {
            unstructured: {
              baseUrl: unstructuredConfig.baseUrl,
              ...(unstructuredKey ? { apiKey: unstructuredKey } : {}),
              ...(typeof unstructuredConfig.timeoutMs === 'number'
                ? { timeoutMs: unstructuredConfig.timeoutMs }
                : {}),
            },
          }
        : {}),
    }),
  });
  deps.folderRagKey = ragKey;
  return deps.folderRag;
}

/**
 * Maps normalized AgentEvent → CE-HOOK events and runs matching hooks.
 * Failures are logged only; they never fail the original agent turn.
 */
export async function dispatchHooksForAgentEvent(
  deps: HostRuntimeKernel,
  sessionId: string,
  event: AgentEvent,
): Promise<void> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const config = await loadPiwinConfig(rootDir);
  if (config.automation?.enabled !== true || config.automation?.hooksEnabled !== true) {
    return;
  }
  let hookEvent: import('@piwin/contracts').HookEventName | null = null;
  let toolName: string | undefined;
  if (event.type === 'session/started') {
    hookEvent = 'agent_start';
  } else if (event.type === 'session/ended') {
    hookEvent = 'agent_end';
  } else if (event.type === 'message/start' && event.role === 'user') {
    hookEvent = 'turn_start';
  } else if (event.type === 'session/aborted' || event.type === 'usage/update') {
    // Abort or completed turn usage → turn_end (message/end has no role).
    hookEvent = 'turn_end';
  } else if (event.type === 'tool/end') {
    hookEvent = 'tool_execution_end';
  }
  if (!hookEvent) {
    return;
  }
  const hooksDocument = await loadHooks(getHooksStorePath(rootDir));
  if (hooksDocument.hooks.length === 0) {
    return;
  }
  const projectPath = deps.sessionProjects.get(sessionId);
  const results = await runMatchingHooks(hooksDocument.hooks, {
    sessionId,
    event: hookEvent,
    ...(projectPath ? { projectPath } : {}),
    ...(toolName ? { toolName } : {}),
  });
  for (const result of results) {
    deps.push({
      type: 'host/log',
      level: result.ok ? 'info' : 'warn',
      message: result.ok
        ? `hook ${result.hookId} ok (${hookEvent})`
        : `hook ${result.hookId} failed: ${result.message ?? 'error'}`,
    });
  }
}

export async function runCronJob(
  deps: HostRuntimeKernel,
  job: import('@piwin/contracts').CronJob,
): Promise<{
  ok: boolean;
  message?: string;
}> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const config = await loadPiwinConfig(rootDir);
  if (config.automation?.enabled !== true) {
    return { ok: false, message: 'automation disabled (config.automation.enabled)' };
  }
  if (config.automation?.cronEnabled !== true) {
    return { ok: false, message: 'cron disabled (config.automation.cronEnabled)' };
  }
  if (job.enabled !== true) {
    return { ok: false, message: `job ${job.id} is disabled` };
  }
  const now = new Date().toISOString();
  let promptSessionId: string | undefined;
  try {
    if (job.type === 'prompt') {
      const projectPath = job.projectPath;
      if (!projectPath) {
        throw new Error('prompt cron requires projectPath');
      }
      const text = job.promptText?.trim() || job.name;
      const session = await deps.createSession({
        projectPath,
        sessionName: `cron-${job.id.slice(0, 8)}`,
      });
      promptSessionId = session.id;
      await deps.bindSession(session, projectPath, `cron-${job.id.slice(0, 8)}`, {
        kind: 'main',
        depth: 0,
      });
      await session.prompt({ text: `[cron:${job.id}] ${text}` });
      const updated = {
        ...job,
        lastRunAt: now,
        lastStatus: 'ok' as const,
      };
      delete (updated as { lastError?: string }).lastError;
      await upsertCronJob(getCronStorePath(rootDir), updated);
      deps.push({ type: 'automation/cron_finished', jobId: job.id, ok: true });
      return { ok: true, message: `prompt session ${session.id}` };
    }
    throw new Error(`cron type ${job.type} not enabled in this slice`);
  } catch (error) {
    if (promptSessionId !== undefined) {
      await deps.disposeLiveSession(promptSessionId).catch(() => undefined);
    }
    const message = formatError(error);
    const updated = {
      ...job,
      lastRunAt: now,
      lastStatus: 'error' as const,
      lastError: message,
    };
    await upsertCronJob(getCronStorePath(rootDir), updated);
    deps.push({
      type: 'automation/cron_finished',
      jobId: job.id,
      ok: false,
      message,
    });
    return { ok: false, message };
  }
}

export function createAgentWorkerSupervisor(deps: HostRuntimeKernel): AgentWorkerSupervisor {
  return new AgentWorkerSupervisor({
    ...(deps.options.agentWorkerScript
      ? { worker: { workerScript: deps.options.agentWorkerScript } }
      : {}),
    onEvent: (sessionId, event) => {
      const childContext = deps.subagentSessionContexts.get(sessionId);
      if (!childContext) return;
      deps.push({
        type: 'subagent/stream',
        parentSessionId: childContext.parentSessionId,
        childSessionId: sessionId,
        event,
      });
      const invocationActivity = subagentInvocationActivityFromEvent(event);
      if (childContext.invocationId && invocationActivity) {
        void deps.subagentOrchestrator
          ?.updateInvocationActivity(childContext.invocationId, invocationActivity)
          .catch((error: unknown) => {
            deps.push({
              type: 'host/log',
              level: 'warn',
              message: `subagent invocation activity persistence failed: ${formatError(error)}`,
            });
          });
      }
      const recorder = deps.transcriptRecorders.get(sessionId);
      if (recorder) {
        void recorder.recordEvent(event).catch((error: unknown) => {
          deps.push({
            type: 'host/log',
            level: 'warn',
            message: `subagent transcript event failed: ${formatError(error)}`,
          });
        });
      }
    },
    onWorkerExit: ({ sessionId, runtimeGenerationId, code }) => {
      const affectedRuns = deps.runRegistry
        .list({
          status: ['queued', 'running', 'cancelling'],
        })
        .filter(
          (run) => run.sessionId === sessionId && run.runtimeGenerationId === runtimeGenerationId,
        );
      for (const run of affectedRuns) {
        void deps.cleanupAfterWorkerCrash(
          run.runId,
          `worker exited unexpectedly (code ${code ?? 'unknown'})`,
        );
      }
    },
    onToolCall: (frame, signal) => {
      const runId = frame.context.runId;
      if (!runId) {
        return Promise.resolve({
          ok: false,
          code: 'tool-not-available' as const,
          message: 'worker tool call has no active Run identity',
        });
      }
      return deps.runExecutionContext.run(
        runId,
        () =>
          deps.sessionHostToolPort?.execute(
            {
              sessionId: frame.context.sessionId,
              runtimeGenerationId: frame.context.runtimeGenerationId,
              runId,
              ...(frame.context.toolCallId ? { toolCallId: frame.context.toolCallId } : {}),
              toolName: frame.toolName,
              arguments: (frame.args ?? {}) as Record<string, unknown>,
            },
            signal,
          ) ??
          Promise.resolve({
            ok: false,
            code: 'tool-not-available' as const,
            message: 'host tool port not available',
          }),
      );
    },
  });
}

/**
 * Give the normal async owner one turn to observe the worker rejection. If
 * it does not, perform the same job/correlator/transcript cleanup as the
 * regular Run termination path before forcing a failed terminal state.
 */
export async function cleanupAfterWorkerCrash(
  deps: HostRuntimeKernel,
  runId: string,
  message: string,
): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const run = deps.runRegistry.get(runId);
  if (!run || isRunTerminal(run.status)) return;
  const rootRunId = run.rootRunId;
  if (deps.workerCrashCleanupRoots.has(rootRunId)) return;
  deps.workerCrashCleanupRoots.add(rootRunId);
  try {
    const subtree = deps.runRegistry.list({ rootRunId });
    const activeSiblingRuns = subtree.filter(
      (candidate) =>
        candidate.runId !== runId &&
        candidate.runId !== rootRunId &&
        !isRunTerminal(candidate.status),
    );
    // Close admission for the complete tree, not only the crashed leaf.
    // This prevents sibling tasks from continuing after one worker has died.
    deps.runRegistry.cancelRun(rootRunId);
    await Promise.all(activeSiblingRuns.map((candidate) => deps.runRegistry.join(candidate.runId)));

    for (const candidate of subtree) {
      if (deps.jobController) {
        await deps.jobController.stopByRun(candidate.runId, 'failed').catch(() => undefined);
      }
      deps.runEventCorrelator.markRunTerminal(candidate.sessionId, candidate.runId);
      const recorder = deps.transcriptRecorders.get(candidate.sessionId);
      if (recorder) {
        await recorder.flush().catch(() => undefined);
      }
    }

    // The crashed worker has no normal owner left to acknowledge its abort.
    // Terminalize that leaf after siblings have joined so SC-09 remains true;
    // the batch/foreground owner can then finish the root Run normally.
    if (deps.runRegistry.isActive(runId)) {
      const crashed = deps.runRegistry.get(runId);
      if (crashed) {
        try {
          await deps.withTranscriptStore(crashed.sessionId, (store) =>
            finalizeRunTranscriptArtifacts(store, {
              runId,
              outcome: 'failed',
              interventionReason: 'worker-crash',
              terminalMessage: message,
            }),
          );
        } catch (error) {
          deps.push({
            type: 'host/log',
            level: 'warn',
            message: `run transcript finalization failed for ${runId}: ${formatError(error)}`,
          });
        }
      }
      deps.runRegistry.terminate(runId, 'failed', 'worker-crash', message);
    }
  } finally {
    deps.workerCrashCleanupRoots.delete(rootRunId);
  }
}

export function getJobController(deps: HostRuntimeKernel): JobController {
  if (!deps.jobController) {
    throw new Error('Job controller is not available');
  }
  return deps.jobController;
}

export function emitJobEvent(deps: HostRuntimeKernel, event: JobRegistryEvent): void {
  deps.push(event);
}

export async function stopProcessesForSession(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<void> {
  if (!deps.jobController) {
    return;
  }
  const cleanup = await deps.jobController.stopBySession(sessionId, 'session-closed');
  if (cleanup.failedJobIds.length > 0) {
    // Cleanup failure must reach the lifecycle boundary; the caller decides
    // whether the session transition fails or degrades (ADR 0030 B4).
    throw new Error(
      `session job cleanup failed for ${sessionId}: ${cleanup.failedJobIds.join(', ')}`,
    );
  }
}

export function getMcpManager(deps: HostRuntimeKernel): McpLifecycleManager {
  if (deps.hostClosing) {
    throw new Error('host-closing');
  }
  if (!deps.mcpManager) {
    deps.mcpManager = createMcpLifecycleManager(getPiwinRoot(deps.options.piwinRoot));
  }
  return deps.mcpManager;
}

/**
 * Lazily create the host-owned BrowserSession (ADR 0020). The session object
 * and its push subscription are passive — Chromium launches only when the
 * desktop acquires its mirror lease or an agent performs a browser operation.
 * Frame/state events are forwarded to `this.push` so the desktop panel
 * mirrors the agent's page. Called before the first Pi session creation so
 * `browser_*` tools register without making Chromium resident.
 */
export async function ensureBrowserSession(
  deps: HostRuntimeKernel,
): Promise<import('@piwin/browser').BrowserSession> {
  if (deps.browserSession) return deps.browserSession;
  if (!deps.browserSessionInit) {
    deps.browserSessionInit = (async () => {
      const { createBrowserSession } = await import('@piwin/browser');
      const session = createBrowserSession();
      deps.browserSessionUnsubscribe = session.subscribe((event) => deps.push(event));
      deps.browserSession = session;
      return session;
    })();
  }
  return deps.browserSessionInit;
}

export function isRpcWorkerMode(deps: HostRuntimeKernel): boolean {
  // RPC mode always means a piwin-owned worker process (ADR 0030 Phase E).
  // The worker backend supports extensions, prompts, and compaction.
  // Stock Pi RPC is not a product path.
  return deps.host.mode === 'rpc';
}

export function ensurePetStateStore(deps: HostRuntimeKernel): Promise<PetStateStore> {
  if (deps.petStateStoreInit) return deps.petStateStoreInit;
  deps.petStateStoreInit = (async () => {
    const root = getPiwinRoot(deps.options.piwinRoot);
    let base: PetRuntimeSnapshot;
    try {
      base = await getActivePet(root, 'idle');
    } catch {
      base = fallbackPetSnapshot();
    }
    const store = createPetStateStore({ basePet: base });
    store.subscribe((snapshot) => {
      deps.push({ type: 'pet/state', pet: snapshot.pet });
    });
    deps.petStateStore = store;
    return store;
  })();
  return deps.petStateStoreInit;
}
