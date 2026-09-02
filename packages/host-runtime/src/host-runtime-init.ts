/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { totalmem } from 'node:os';
import {
  deriveMemoryHighWaterMiB,
  formatError,
  LEGACY_LOCAL_SINK_ID,
  normalizeSessionRuntimeRetentionConfig,
  DEFAULT_MAX_CONCURRENT_RUNS,
  createDefaultSubagentConfig,
} from '@piwin/contracts';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { createMcpLifecycleManager } from '@piwin/mcp';
import { createFileRecordStore, createJobRegistry, type JobRegistryEvent } from '@piwin/process';
import { listProjects } from '@piwin/project';

import { getSessionRecord } from '@piwin/session';
import { createSessionTranscriptStoreRegistry } from './session-transcript-store-registry.js';
import { ProductAgentHost } from './product-agent-host.js';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinProjectsPath, getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { fail } from './response-helpers.js';
import { RunRegistry } from './run-registry.js';
import { handleSessionLiveCommand } from './commands/session-live-commands.js';
import { QueuedTurnController } from './queued-turn-controller.js';
import { SessionRuntimeController } from './sessions/session-runtime-controller.js';
import { createSessionRuntimeResidencyController } from './sessions/session-runtime-residency-controller.js';
import { createImmediateSafetyPredicate } from './sessions/immediate-safety-gate.js';
import { SessionRuntimeReplacementEngine } from './session-runtime-replacement.js';
import { createSessionHostToolExecutionPort } from './tools/session-host-tool-port.js';
import { openTurnChangeRuntime } from './turn-changes/runtime-wiring.js';
import { createSubagentResultService } from './subagent-result-service.js';
import { descriptorsFromTools } from './tools/build-session-host-tools.js';
import { toolFamilyIndex } from './tools/tool-family-index.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import { createRuntimeResourceCoordinator } from './runtime-resource-coordinator.js';
import { acquirePiwinRootLease } from './piwin-root-lease.js';
import { openLocalAuthUrl } from './open-local-auth-url.js';
import { SubscriptionAuthService } from './subscription-auth-service.js';
import { cancelRunsForSubscriptionProvider } from './cancel-subscription-runs.js';
import { applySettingsRuntimeImpact } from './apply-settings-runtime-impact.js';
import { rewritePersistedChannelRefs } from './rewrite-persisted-channel-refs.js';
import { isSubscriptionAccountUsable } from './resolve-chat-model.js';
import { composeHostLive } from './voice/compose-host-live.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import type { HostRuntimeOptions } from './host-runtime-types.js';
import { createSessionContextCoordinator } from './session-context-coordinator.js';
import { recordFinalizedUsageToLedger } from './host-runtime-usage-ledger.js';
import { notifyForegroundSessionTurnTerminal } from './host-runtime-services.js';

export function initializeHostRuntime(deps: HostRuntimeKernel, options: HostRuntimeOptions): void {
  const rootOwnershipEnabled = options.rootOwnership?.enabled ?? process.env.NODE_ENV !== 'test';
  let leaseCompromiseHandler: (error: Error) => void = () => undefined;
  const rootLease = rootOwnershipEnabled
    ? acquirePiwinRootLease({
        rootDir: getPiwinRoot(options.piwinRoot),
        ownerKind: options.rootOwnership?.ownerKind ?? 'cli-command',
        ...(options.rootOwnership?.hostInstanceId
          ? { hostInstanceId: options.rootOwnership.hostInstanceId }
          : {}),
        onCompromised: (error) => leaseCompromiseHandler(error),
      })
    : null;
  deps.rootLease = rootLease;
  deps.hostInstanceId =
    rootLease?.owner.hostInstanceId ?? options.rootOwnership?.hostInstanceId ?? randomUUID();
  if (rootLease) {
    options = { ...options, piwinRoot: rootLease.canonicalRootDir };
  }

  try {
    deps.options = options;
    deps.extensionRevisionStore = createExtensionRevisionStore(getPiwinRoot(options.piwinRoot));
    deps.transcriptStores = createSessionTranscriptStoreRegistry({
      rootDir: getPiwinRoot(options.piwinRoot),
      onDiagnostic: (message) =>
        deps.push({ type: 'host/log', level: 'info', message: `[transcript] ${message}` }),
    });
    deps.sessionContextCoordinator = createSessionContextCoordinator({
      now: () => Date.now(),
      nowIso: () => new Date().toISOString(),
      getStore: (sessionId) => {
        const projectPath = deps.sessionProjects.get(sessionId) ?? '';
        return deps.transcriptStores.get(sessionId, projectPath);
      },
      push: (message) => deps.push(message),
      recordFinalizedUsage: (sessionId, measurement) =>
        recordFinalizedUsageToLedger(deps, sessionId, measurement),
      log: (level, message) => {
        deps.push({ type: 'host/log', level, message });
      },
      getBoundGenerationId: (sessionId) => deps.runtimeController.getStatus(sessionId).generationId,
    });
    if (options.onPush) {
      deps.pushSinks.set(LEGACY_LOCAL_SINK_ID, {
        id: LEGACY_LOCAL_SINK_ID,
        push: options.onPush,
      });
    }
    deps.subscriptionAuth = new SubscriptionAuthService({
      ...(options.piwinRoot !== undefined ? { piwinRoot: options.piwinRoot } : {}),
      openAuthUrl: openLocalAuthUrl,
    });
    deps.subscriptionAuth.bindPush((message) => deps.push(message));
    if (options.mock !== true) {
      deps.subscriptionAuth.startWatch();
      void deps.subscriptionAuth.ensureLoggedInProviders().catch((error: unknown) => {
        deps.push({
          type: 'host/log',
          level: 'warn',
          message: `[auth] failed to seed subscription providers: ${formatError(error)}`,
        });
      });
    }
    const extensionRecovery = deps
      .recoverInterruptedExtensionDeployments()
      .catch((error: unknown) => {
        deps.push({
          type: 'host/log',
          level: 'error',
          message: `extension deployment startup recovery failed: ${formatError(error)}`,
        });
        throw error;
      });
    // Consumers await this promise lazily (first extension command); keep a
    // terminal handler so a failure is never reported as an unhandled
    // rejection when no extension command arrives.
    void extensionRecovery.catch(() => undefined);
    deps.extensionDeploymentStartupRecovery = extensionRecovery;
    deps.runRegistry = new RunRegistry({
      onRunUpdated: (run) => deps.push({ type: 'run/updated', run }),
      onRunTerminal: (run) => {
        deps.sessionHostToolPort?.releaseRun(run.sessionId, run.runId);
        deps.healthToolRunBudget.release(run.runId);
        void deps.browserSession?.releaseAgentControlIfHeldBy(run.runId);
        deps.push({ type: 'run/terminal', run });
        notifyForegroundSessionTurnTerminal(deps, run);
        deps.queuedTurnController.notifyRunTerminal(run);
        deps.liveCallCoordinator?.notifyBoundSessionTurnEnded({
          sessionId: run.sessionId,
          runId: run.runId,
          kind: run.kind,
          status: run.status,
          assistantText: deps.sessionLastAssistantReply.get(run.sessionId) ?? '',
        });
      },
    });
    deps.queuedTurnController = new QueuedTurnController({
      getTranscriptStore: (sessionId) => deps.getTranscriptStore(sessionId),
      hasSession: async (sessionId) => {
        if (deps.sessions.has(sessionId)) return true;
        const record = await getSessionRecord(
          getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot)),
          sessionId,
        );
        return record !== undefined;
      },
      getForegroundRun: (sessionId) => deps.runRegistry.getForegroundRun(sessionId),
      getRun: (runId) => deps.runRegistry.get(runId),
      requestCancelRun: (sessionId, runId) => {
        const active = deps.runRegistry.getForegroundRun(sessionId);
        if (!active || active.runId !== runId) return undefined;
        return deps.runRegistry.requestCancel(runId, 'replace-run');
      },
      updateRunPhase: (runId, phase, detail) => {
        deps.runRegistry.updatePhase(runId, phase, detail);
      },
      settlePendingPermissions: (sessionId) => {
        for (const [requestId, pending] of deps.pendingPermissions.entries()) {
          if (pending.sessionId === sessionId) {
            pending.resolve('deny');
            deps.pendingPermissions.delete(requestId);
          }
        }
      },
      settlePendingExtensionUi: (sessionId) => deps.settlePendingExtensionUiForSession(sessionId),
      validatePromptAttachments: (input) => deps.validatePromptAttachments(input),
      admitPrompt: (command) =>
        handleSessionLiveCommand(command, command.id, deps.buildSessionLiveContext()).then(
          (response) => {
            const data = (response?.success ? response.data : undefined) as
              { runId?: unknown } | undefined;
            if (
              response?.success &&
              typeof data?.runId === 'string' &&
              command.input.source === 'voice-delegation' &&
              command.input.voiceCallId &&
              command.input.clientMessageId
            ) {
              deps.liveCallCoordinator?.bindQueuedDelegationRun({
                callId: command.input.voiceCallId,
                sessionId: command.sessionId,
                messageId: command.input.clientMessageId,
                runId: data.runId,
              });
            }
            return response ?? fail(command.id, 'session/prompt', 'queued prompt was not handled');
          },
        ),
      push: (message) => deps.push(message),
    });
    deps.runtimeController = new SessionRuntimeController({
      isRunInFlight: (sessionId) => {
        const generationId = deps.runtimeController.getStatus(sessionId).generationId;
        return deps.runRegistry
          .list({
            status: ['queued', 'running', 'cancelling'],
          })
          .some(
            (run) =>
              run.sessionId === sessionId ||
              (generationId !== undefined && run.runtimeGenerationId === generationId),
          );
      },
      onChanged: (status) => deps.push({ type: 'session/runtime-updated', status }),
    });
    // ADR 0040 §2/§5/§6: the residency state machine decides when a runtime
    // may be created or must be suspended. HostRuntime owns the real cleanup
    // transaction (`suspendSessionRuntime`) and the blocker predicate that
    // keeps active/cancelling/permission/UI/compaction/replacement runtimes
    // resident. §3/§8: the adaptive RSS high water (25% of system memory,
    // clamped 512–2048 MiB) powers admission eviction; worker samples are
    // cached and marked incomplete when missing/stale.
    deps.runtimeRetention = normalizeSessionRuntimeRetentionConfig(undefined);
    deps.runtimeMemoryHighWaterMiB = deriveMemoryHighWaterMiB(totalmem() / 1024 / 1024);
    deps.runtimeResourceCoordinator = createRuntimeResourceCoordinator({
      configuredMaxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
      subagentMaxConcurrency: createDefaultSubagentConfig().maxConcurrency,
    });
    deps.residencyController = createSessionRuntimeResidencyController({
      retention: {
        ...deps.runtimeRetention,
        memoryHighWaterMiB: deps.runtimeMemoryHighWaterMiB,
      },
      resolveMaxResidentRuntimes: () => {
        return (
          deps.runtimeResourceCoordinator?.getStatus().configuredMaxConcurrentRuns ??
          DEFAULT_MAX_CONCURRENT_RUNS
        );
      },
      isRuntimeProtected: (sessionId) => deps.isSessionRuntimeProtected(sessionId),
      onResidencyChanged: (entry) => {
        deps.runtimeController.setResidency(
          entry.sessionId,
          entry.state,
          entry.state === 'suspending' && entry.lastEvictionReason !== undefined
            ? { lastEvictionReason: entry.lastEvictionReason }
            : undefined,
        );
      },
      suspendRuntime: (input) => {
        return deps.suspendSessionRuntime(input.sessionId, input.runtimeGenerationId, input.reason);
      },
      onSweep: () => {
        // Keep runtime lease heartbeats fresh for every resident session so a
        // long-idle runtime never looks abandoned to a foreign Host (2-minute
        // stale window vs. 30s sweep).
        for (const sessionId of deps.runtimeLeaseStartedAt.keys()) {
          void deps.heartbeatRuntimeLease(sessionId).catch(() => undefined);
        }
      },
      sampleMemory: () => {
        const hostRssMiB = Math.max(1, Math.round(process.memoryUsage().rss / 1024 / 1024));
        const worker = deps.workerRssSample;
        if (!worker || worker.rssMiB <= 0) {
          return { hostRssMiB, sampleCompleteness: worker?.completeness ?? 'missing' };
        }
        return {
          hostRssMiB,
          workerRssMiB: worker.rssMiB,
          sampleCompleteness: worker.completeness,
        };
      },
    });
    deps.runtimeReplacementEngine = new SessionRuntimeReplacementEngine({
      controller: deps.runtimeController,
      getActiveGenerationId: (sessionId) =>
        deps.runtimeController.getStatus(sessionId).generationId,
      getRunIds: (_sessionId, generationId) =>
        deps.runRegistry
          .list({ status: ['queued', 'running', 'cancelling'] })
          .filter((run) => run.runtimeGenerationId === generationId)
          .map((run) => run.runId),
      waitForRuns: async (runIds) => {
        await Promise.all(runIds.map((runId) => deps.runRegistry.join(runId)));
      },
      compileCandidate: (sessionId, generationId, settingsRevision, excludeSeedMessageId) =>
        deps.compileRuntimeCandidate(
          sessionId,
          generationId,
          settingsRevision,
          excludeSeedMessageId,
        ),
      disposeGeneration: (sessionId, generationId) =>
        deps.disposeRuntimeGeneration(sessionId, generationId),
      createGeneration: (sessionId, candidate) =>
        deps.createRuntimeGeneration(sessionId, candidate),
      rollbackGeneration: (sessionId, generationId) =>
        deps.rollbackRuntimeGeneration(sessionId, generationId),
      abortGeneration: (sessionId, generationId) =>
        deps.abortRuntimeGeneration(sessionId, generationId),
      onCleanupError: ({ sessionId, generationId, error }) => {
        deps.push({
          type: 'host/log',
          level: 'error',
          message: `runtime replacement cleanup failed for ${sessionId}/${generationId}: ${formatError(error)}`,
        });
      },
    });
    // Single process owner for Desktop UI lifecycle + SDK session tools.
    const rootDir = getPiwinRoot(options.piwinRoot);
    const mcpManager = createMcpLifecycleManager(rootDir);
    deps.mcpManager = mcpManager;
    // CE-JOB: unified job controller — sole authority for non-interactive
    // OS child processes (ADR 0030 Phase B). No legacy compatibility layer.
    // ADR 0030: durable JobRecord persistence for host-start reconciliation.
    const jobRecordStore = createFileRecordStore(join(rootDir, 'jobs', 'records.json'));
    const jobController = createJobRegistry({
      recordStore: jobRecordStore,
      // Admission policy is derived from the persisted settings on every
      // start, so a settings tighten (maxProcesses / enabled) applies to new
      // Jobs immediately without killing already-running Jobs (ADR 0030 B1).
      getJobPolicy: async () => {
        try {
          const config = await loadPiwinConfig(deps.options.piwinRoot);
          const processConfig = config.process;
          const maxActiveJobs =
            typeof processConfig?.maxProcesses === 'number' && processConfig.maxProcesses > 0
              ? processConfig.maxProcesses
              : 8;
          return {
            enabled: processConfig?.enabled !== false,
            maxActiveJobs,
          };
        } catch {
          // Unreadable settings must not silently block or permit Jobs; keep
          // the safe default (enabled with the registry default capacity).
          return { enabled: true, maxActiveJobs: 8 };
        }
      },
      getTrustedProjectRoots: async () => {
        try {
          const projects = await listProjects(getPiwinProjectsPath(rootDir));
          return projects
            .filter((project) => project.trust === 'trusted')
            .map((project) => project.path);
        } catch (error) {
          const detail = formatError(error);
          deps.push({
            type: 'host/log',
            level: 'warn',
            message: `trusted project roots read failed (jobs): ${detail}`,
          });
          return [];
        }
      },
      onEvent: (event: JobRegistryEvent) => deps.emitJobEvent(event),
    });
    deps.jobController = jobController;

    const commonHostOptions = {
      mode: options.mode,
      ...(options.piwinRoot ? { piwinRoot: options.piwinRoot } : {}),
      onGenerationCreated: (
        sessionId: string,
        generationId: string,
        settingsRevision: string,
        extensionSetRevision?: string,
      ) =>
        deps.runtimeController.attachGeneration(
          sessionId,
          generationId,
          settingsRevision,
          extensionSetRevision,
        ),
      onGenerationDetached: async (sessionId: string) => {
        deps.runtimeController.detachGeneration(sessionId);
        deps.sessionHostToolPort?.clearSession(sessionId);
        await deps.releaseGenerationToolSurfaces(sessionId);
      },
      getMcpConfig: async (sessionId: string, runtimeGenerationId: string) =>
        deps.getGenerationMcpConfig(sessionId, runtimeGenerationId),
      getMcpCapabilityBrief: async (sessionId: string, runtimeGenerationId: string) =>
        deps.getGenerationMcpCapabilityBrief(sessionId, runtimeGenerationId),
      getPermissionRulesRevision: (sessionId: string, runtimeGenerationId: string) =>
        deps.generationPermissionRuleRevisions.get(`${sessionId}\u0000${runtimeGenerationId}`),
      restrictToolSurface: (
        sessionId: string,
        runtimeGenerationId: string,
        toolNames: readonly string[],
        toolboxTargetNames: readonly string[],
        mcpCatalogEnabled: boolean,
      ) => {
        if (
          !deps.sessionHostToolPort?.restrictGeneration(
            sessionId,
            runtimeGenerationId,
            toolNames,
            toolboxTargetNames,
            mcpCatalogEnabled,
          )
        ) {
          throw new Error(
            `compiled Host tool surface is not registered: ${sessionId}/${runtimeGenerationId}`,
          );
        }
      },
      getCurrentRunId: () => deps.runExecutionContext.getStore(),
      ...(options.testFixture !== undefined ? { testFixture: options.testFixture } : {}),
      getSubscriptionCompileContext: async () => {
        const accounts = (await deps.subscriptionAuth?.chatResolveInput()) ?? { accounts: [] };
        return {
          usableSubscriptionProviderIds: accounts.accounts
            .filter((account) => isSubscriptionAccountUsable(account))
            .map((account) => account.providerId),
          subscriptionAccounts: accounts,
        };
      },
    };
    if (options.mock === true) {
      deps.sessionHostToolPort = null;
      deps.host = new ProductAgentHost({ ...commonHostOptions, mock: true });
    } else {
      deps.turnChangeRuntime = openTurnChangeRuntime({
        hostInstanceId: deps.hostInstanceId,
        ...(options.piwinRoot !== undefined ? { piwinRoot: options.piwinRoot } : {}),
      });
      deps.subagentResultService = createSubagentResultService({
        changeStore: deps.turnChangeRuntime.store,
        objectStore: deps.turnChangeRuntime.objectStore,
      });
      deps.sessionHostToolPort = createSessionHostToolExecutionPort({
        isSessionKnown: (sessionId) =>
          deps.runtimeController.hasActiveGeneration(sessionId) ||
          deps.sessions.has(sessionId) ||
          deps.subagentSessionContexts.has(sessionId),
        capture: deps.turnChangeRuntime.capture,
        tracker: deps.turnChangeRuntime.tracker,
        getRuntimeGenerationId: (sessionId) =>
          deps.subagentSessionContexts.get(sessionId)?.runtimeGenerationId ??
          deps.runtimeController.getStatus(sessionId).generationId,
        isRunAdmitted: (runId, sessionId, runtimeGenerationId) => {
          const run = deps.runRegistry.get(runId);
          const admitted =
            run?.status === 'running' &&
            run.sessionId === sessionId &&
            run.runtimeGenerationId === runtimeGenerationId;
          if (!admitted) {
            // CE run-admission diagnostics: log WHY a tool frame was rejected.
            // The model sees only "run is not admitted for tool execution", so
            // the exact failure reason must be captured host-side.
            const denialKey = `${sessionId}\u0000${runId}`;
            const count = (deps.runAdmissionDenials.get(denialKey) ?? 0) + 1;
            deps.runAdmissionDenials.set(denialKey, count);
            const foreground = deps.runRegistry.getForegroundRun(sessionId);
            const activeGeneration = deps.runtimeController.getStatus(sessionId).generationId;
            let why: string;
            if (!run) {
              why = 'run-missing';
            } else if (run.status !== 'running') {
              why = `status=${run.status}`;
            } else if (run.sessionId !== sessionId) {
              why = `session-mismatch run=${run.sessionId} frame=${sessionId}`;
            } else {
              why = `generation-mismatch run=${run.runtimeGenerationId} frame=${runtimeGenerationId}`;
            }
            // First denial per (runId, sessionId) logs in full; repeats are
            // sampled at 1/10 to avoid flooding the host log during loops.
            if (count === 1 || count % 10 === 0) {
              deps.push({
                type: 'host/log',
                level: 'warn',
                message:
                  `run admission denied (x${count}): runId=${runId} sessionId=${sessionId} ` +
                  `why=${why} frameGen=${runtimeGenerationId} ` +
                  `activeGen=${activeGeneration} foregroundRun=${foreground?.runId ?? '-'} ` +
                  `foregroundStatus=${foreground?.status ?? '-'}`,
              });
            }
          }
          return admitted;
        },
        // Repair spec WP2: the live safety predicate reads only exact
        // capability-restriction domains on every tool call. A Web source
        // switch still makes the runtime stale, but does not disable all Web
        // tools while the replacement generation is being prepared.
        isToolDisabled: createImmediateSafetyPredicate({
          getPendingDomains: (sessionId) => {
            const safetySessionId =
              deps.subagentSessionContexts.get(sessionId)?.parentSessionId ?? sessionId;
            return deps.runtimeController.getImmediateTighteningDomains(safetySessionId);
          },
          getPendingRestrictions: (sessionId) => {
            const safetySessionId =
              deps.subagentSessionContexts.get(sessionId)?.parentSessionId ?? sessionId;
            return deps.runtimeController.getImmediateRestrictions(safetySessionId);
          },
        }),
      });
      deps.agentWorkerSupervisor = deps.createAgentWorkerSupervisor();
      deps.host = new ProductAgentHost({
        ...commonHostOptions,
        mock: false,
        hostToolExecution: deps.sessionHostToolPort,
        buildToolDescriptors: async (
          sessionId,
          runtimeGenerationId,
          model,
          mode = 'active',
          projectPath,
        ) => {
          const tools = await deps.buildSessionHostToolsForSession(
            sessionId,
            runtimeGenerationId,
            model,
            mode,
            projectPath,
          );
          return descriptorsFromTools(tools);
        },
        buildToolFamilyIndex: async (
          sessionId,
          runtimeGenerationId,
          model,
          mode = 'active',
          projectPath,
        ) => {
          const tools = await deps.buildSessionHostToolsForSession(
            sessionId,
            runtimeGenerationId,
            model,
            mode,
            projectPath,
          );
          return toolFamilyIndex(tools);
        },
        // Resolve trust from the project store so untrusted projects
        // cannot compile write/process/bash/delegate capabilities.
        trustResolver: async (projectPath: string) => {
          try {
            const rootDir = getPiwinRoot(deps.options.piwinRoot);
            const projects = await listProjects(getPiwinProjectsPath(rootDir));
            const record = projects.find((p) => p.path === projectPath);
            return record?.trust === 'trusted';
          } catch {
            return false;
          }
        },
        workerSupervisor: deps.agentWorkerSupervisor,
      });

      // ADR 0030 Phase D-3: compose the production SubagentOrchestrator.
      // Only non-mock mode gets real worker processes, workspace services,
      // and integration coordinators. Mock mode leaves the orchestrator null
      // and batch IPC returns a normalized not-ready response.
      deps.composeSubagentOrchestrator();
    }
    composeHostLive(deps);
    deps.subscriptionAuth?.bindCancelRuns((providerId) =>
      cancelRunsForSubscriptionProvider(deps, providerId),
    );
    deps.subscriptionAuth?.bindSettingsApplied((result) =>
      applySettingsRuntimeImpact(deps, result),
    );
    deps.subscriptionAuth?.bindRelocatePersist((fromProviderId, toProviderId) =>
      rewritePersistedChannelRefs({
        ...(options.piwinRoot !== undefined ? { piwinRoot: options.piwinRoot } : {}),
        fromProviderId,
        toProviderId,
        sessionModels: deps.sessionModels,
      }),
    );
    leaseCompromiseHandler = (error) => {
      deps.ready = false;
      deps.hostClosing = true;
      deps.push({
        type: 'host/log',
        level: 'error',
        message: `piwin root ownership was compromised: ${error.message}`,
      });
      void deps.dispose().catch(() => undefined);
    };
  } catch (error) {
    try {
      rootLease?.release();
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        'HostRuntime initialization failed and root ownership could not be released cleanly',
      );
    }
    throw error;
  }
}
