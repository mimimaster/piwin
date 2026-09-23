/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import type {
  HostToolRegistration,
  McpConfigDocument,
  ModelRef,
  PermissionMode,
  SessionIndexRecord,
} from '@piwin/contracts';
import { randomUUID } from 'node:crypto';
import { formatError, normalizeExecutionConfig } from '@piwin/contracts';
import { healthProviderDisclosure } from './health-turn-display.js';
import { effectivePermissionMode } from './effective-permission-mode.js';
import { evaluateBashPermission } from './permission-policy.js';
import { isWorktreeConfinedRecursiveRemove } from './subagent-worktree-rm-approval.js';
import { loadMcpConfig, createMcpGenerationSnapshot } from '@piwin/mcp';
import { listProjects } from '@piwin/project';
import { getSessionRecord } from '@piwin/session';
import { isGeneralWorkspacePath } from './general-workspace.js';
import {
  artifactScopeKeyForIndexRecord,
  resolveGenerationArtifactCapability,
} from './session-scope.js';

import { type ProductAgentHostToolRegistrationMode } from './product-agent-host.js';
import { loadPiwinConfig } from './config-store.js';
import { createSecretResolver } from './secret-resolver.js';
import {
  getPiwinGeneralWorkspacePath,
  getPiwinProjectsPath,
  getPiwinRoot,
  getPiwinSessionIndexPath,
} from './paths.js';
import { applySessionMcpOverrides, sessionMcpOverrideKey } from './session-mcp-overrides.js';
import { createBundledRuleSet } from './permission-defaults.js';
import { resolvePermissionProjectRoot } from './permission-project-root.js';
import { computePermissionRulesRevision } from './permission-rule-revision.js';
import { loadMergedPermissionRules } from './permission-rule-loader.js';
import { fail } from './response-helpers.js';
import { createSubagentReviewService } from './subagent-review-service.js';
import { buildSessionHostTools } from './tools/build-session-host-tools.js';
import { bindCaptureReceipts } from './turn-changes/tool-capture.js';
import { resolveTurnChangeWorkspaceRoot } from './turn-changes/runtime-wiring.js';
import type { McpCapabilityBrief } from './mcp-capability-brief.js';
import { createHostToolAdmission } from './tools/tool-admission.js';
import { createToolResourceGate, getSharedSystemMemoryMonitor } from './system-memory.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import type { ComposedSessionHostTools } from './host-runtime-types.js';
import { ensureBrowserSessionBestEffort } from './host-runtime-services.js';

/**
 * Compose Host-owned tools for one session for the parent tool execution port.
 * Permission prompts are bound to this sessionId via requestPermission.
 *
 * `mode` selects where the composed surface is registered:
 * - `active`: the session's current executable generation (initial create,
 *   and the candidate commit step via `commitPendingGeneration`).
 * - `pending`: a candidate generation that cannot execute tool calls until
 *   it is committed (repair spec WP1).
 */
export async function buildSessionHostToolsForSession(
  deps: HostRuntimeKernel,
  sessionId: string,
  runtimeGenerationId: string,
  model?: ModelRef,
  mode: ProductAgentHostToolRegistrationMode = 'active',
  projectPath?: string,
): Promise<HostToolRegistration[]> {
  const surfaceKey = `${sessionId}\u0000${runtimeGenerationId}`;
  let surfacePromise = deps.generationToolSurfaces.get(surfaceKey);
  if (!surfacePromise) {
    surfacePromise = deps.composeSessionHostToolsForSession(
      sessionId,
      runtimeGenerationId,
      model,
      projectPath,
    );
    deps.generationToolSurfaces.set(surfaceKey, surfacePromise);
  }
  try {
    const { tools, permissionGate } = await surfacePromise;
    if (mode === 'pending') {
      deps.sessionHostToolPort?.registerPendingGeneration(
        sessionId,
        runtimeGenerationId,
        tools,
        permissionGate,
      );
    } else {
      deps.sessionHostToolPort?.registerActiveGeneration(
        sessionId,
        runtimeGenerationId,
        tools,
        permissionGate,
      );
    }
    return tools;
  } catch (error) {
    await deps.releaseGenerationToolSurface(sessionId, runtimeGenerationId);
    throw error;
  }
}

export async function composeSessionHostToolsForSession(
  deps: HostRuntimeKernel,
  sessionId: string,
  runtimeGenerationId: string,
  model?: ModelRef,
  projectPathOverride?: string,
): Promise<ComposedSessionHostTools> {
  const childContext = deps.subagentSessionContexts.get(sessionId);
  // Initial and cold generations are composed before bindSession installs the
  // resident map, so prefer the creation-time path when one is supplied.
  const projectPath =
    childContext?.workingDirectory ?? projectPathOverride ?? deps.sessionProjects.get(sessionId);
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  let config: import('@piwin/contracts').PiwinConfig | undefined;
  try {
    config = await loadPiwinConfig(deps.options.piwinRoot);
  } catch (error) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `config composition failed; config-dependent capabilities omitted: ${formatError(error)}`,
    });
    // Config load failure — tools that need config will be omitted.
  }
  deps.permissionModeFromConfig = config?.permissions?.mode ?? 'auto';
  let mcpConfig: McpConfigDocument | undefined;
  try {
    mcpConfig = await loadMcpConfig(rootDir);
  } catch (error) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `mcp-config composition failed; MCP capability omitted: ${formatError(error)}`,
    });
    // Invalid/unreadable MCP config fails closed for this generation.
  }
  let sessionDisabledMcpServerIds: string[] | undefined;
  let sessionRecord: SessionIndexRecord | undefined;
  try {
    const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
    sessionRecord = record ?? undefined;
    sessionDisabledMcpServerIds = record?.disabledMcpServerIds;
  } catch (error) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `session MCP overrides unreadable; using global MCP servers: ${formatError(error)}`,
    });
  }
  const mcpSnapshot = createMcpGenerationSnapshot(
    applySessionMcpOverrides(mcpConfig ?? { mcpServers: {} }, sessionDisabledMcpServerIds),
    `${sessionId}\u0000${runtimeGenerationId}`,
  );
  deps.generationMcpConfigs.set(`${sessionId}\u0000${runtimeGenerationId}`, mcpSnapshot.config);
  deps.generationMcpSnapshots.set(`${sessionId}\u0000${runtimeGenerationId}`, mcpSnapshot);
  deps.generationSessionMcpOverrideKeys.set(
    `${sessionId}\u0000${runtimeGenerationId}`,
    sessionMcpOverrideKey(sessionDisabledMcpServerIds),
  );
  let rules = createBundledRuleSet();
  let mcpCapabilityBrief: McpCapabilityBrief | undefined;
  let projectTrusted = false;
  // A subagent runs in a Host-owned worktree under ~/.piwin that is never in
  // the trusted project list. Its trust is the repository it was cut from;
  // judging the worktree path downgraded a YOLO parent's children to `auto`.
  const trustPath = childContext?.parentRepoPath ?? projectPath;
  try {
    if (trustPath) {
      if (isGeneralWorkspacePath(trustPath, rootDir)) {
        projectTrusted = true;
      } else {
        const projects = await listProjects(getPiwinProjectsPath(rootDir));
        projectTrusted = projects.some(
          (project) => project.path === trustPath && project.trust === 'trusted',
        );
      }
    }
    rules = await loadMergedPermissionRules({
      piwinRoot: rootDir,
      ...(projectPath ? { projectPath, projectTrusted } : {}),
    });
  } catch (error) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `permission-rule composition failed; bundled rules remain active: ${formatError(error)}`,
    });
    // Bundled rules remain the fail-closed baseline when user/project rules
    // cannot be loaded; the generation still has a deterministic snapshot.
  }
  const workspaceRoot = resolveTurnChangeWorkspaceRoot({
    ...(childContext?.workingDirectory !== undefined
      ? { childWorkingDirectory: childContext.workingDirectory }
      : {}),
    ...(projectPath !== undefined ? { projectPath } : {}),
    piwinRoot: deps.options.piwinRoot,
  });
  const turnChangeRuntime = deps.turnChangeRuntime;
  // Cold activate / generation rebuild skip createSession, which used to be
  // the only caller of ensureBrowserSession. Compose is the shared path, so
  // register the passive session here or `browser_*` never reach the model.
  await ensureBrowserSessionBestEffort(deps);
  // Artifact capability must match the compiled manifest: both derive the scope
  // class from the same durable record. A subagent generation gets no Artifact
  // surface; an unreadable record leaves the capability unresolved so the
  // master switch alone decides rather than guessing a class.
  const subagent = childContext !== undefined || sessionRecord?.kind === 'subagent';
  const artifactScopeKey = childContext ? 'project' : artifactScopeKeyForIndexRecord(sessionRecord);
  const artifactCapability =
    artifactScopeKey === undefined
      ? undefined
      : resolveGenerationArtifactCapability(config?.artifact, artifactScopeKey, subagent);
  const tools = await buildSessionHostTools({
    sessionId,
    piwinRoot: rootDir,
    ...(projectPath !== undefined ? { projectPath } : {}),
    ...(turnChangeRuntime
      ? {
          turnChange: {
            workspaceRoot,
            store: turnChangeRuntime.objectStore,
            onReceipt: bindCaptureReceipts(turnChangeRuntime.capture),
          },
          workspaceWrite: {
            gate: turnChangeRuntime.gate,
            workspaceId: workspaceRoot,
            rootPath: workspaceRoot,
          },
        }
      : {}),
    jobController: deps.jobController,
    fetchCache: deps.fetchCache,
    ...(deps.mcpManager ? { mcpManager: deps.mcpManager } : {}),
    mcpConfig: mcpSnapshot.config,
    mcpSnapshot,
    runtimeGenerationId,
    ...(config ? { config } : {}),
    ...(artifactCapability ? { artifactCapability } : {}),
    ...(model ? { model } : {}),
    ...(config ? { secretResolver: createSecretResolver() } : {}),
    getBrowserSession: () => deps.browserSession ?? undefined,
    getNotesServices: () => deps.getNotesServices(),
    getCardStore: () => deps.getCardStore(),
    getFolderRag: () => deps.getFolderRag(),
    isIndexing: (folderKey) => deps.doccardsIngestion.isRunning(folderKey),
    // Root sessions only: a subagent generation carries a childContext and must
    // never be handed the extension install surface.
    ...(childContext
      ? {}
      : {
          applyExtensions: async (when: 'after-current-run') => {
            const deploymentId = randomUUID();
            const operation = deps.executeExtensionApply(
              { type: 'extensions/apply', sessionId, when, deploymentId },
              undefined,
            );
            deps.extensionDeploymentPromisesById.set(deploymentId, operation);
            try {
              const response = await operation;
              return response.success
                ? { ok: true as const, phase: 'scheduled' }
                : { ok: false as const, error: response.error };
            } finally {
              if (deps.extensionDeploymentPromisesById.get(deploymentId) === operation) {
                deps.extensionDeploymentPromisesById.delete(deploymentId);
              }
            }
          },
        }),
    onPlanUpdated: (plan) => {
      deps.push({ type: 'plan/updated', sessionId, plan });
    },
    onDiagnostic: ({ message }) => deps.push({ type: 'host/log', level: 'warn', message }),
    onMcpCapabilityBrief: (brief) => {
      mcpCapabilityBrief = brief;
    },
    ...(childContext
      ? {}
      : (() => {
          const seam = deps.getSubagentSeam(sessionId);
          return seam ? { subagentSeam: seam } : {};
        })()),
    ...(childContext?.reviewScope && deps.subagentResultService
      ? {
          reviewScope: childContext.reviewScope,
          resultService: deps.subagentResultService,
          ...(deps.subagentRunStore
            ? {
                reviewService: createSubagentReviewService({
                  runStore: deps.subagentRunStore,
                  resultService: deps.subagentResultService,
                  publish: (message) => deps.push(message),
                }),
                ...(childContext.invocationId
                  ? { reviewerInvocationId: childContext.invocationId }
                  : {}),
              }
            : {}),
        }
      : {}),
    ...(deps.options.clientToolExecution === undefined || childContext
      ? {}
      : {
          clientToolExecution: deps.options.clientToolExecution,
          healthToolRunBudget: deps.healthToolRunBudget,
          resolveHealthDisplay: (context: { sessionId: string }) => {
            const stored = deps.healthTurnBySession.get(context.sessionId);
            const provider = healthProviderDisclosure(
              deps.sessionModels.get(context.sessionId),
              config,
            );
            return {
              explicitTurnIntent: stored?.explicit === true,
              ...(provider === undefined ? {} : { provider }),
            };
          },
        }),
  });
  // Repair spec WP3: the permission admission gate is bound to the frozen
  // generation snapshot (rules + MCP allowlist) and reads the dynamic
  // PermissionMode on every call. Executors never re-derive a decision.
  const getPermissionMode = (): PermissionMode => {
    // A child has no mode picker of its own; it follows the parent's session mode.
    // A worktree child is the exception: spawning it already authorized writes
    // inside that copy, so parent ask-all must not prompt for each one.
    // Leave-workspace asks and deny rules still apply, because the mode stays
    // auto rather than bypass.
    const sessionOverride =
      deps.sessionPermissionOverrides.get(sessionId) ??
      (childContext
        ? deps.sessionPermissionOverrides.get(childContext.parentSessionId)
        : undefined);
    const mode = effectivePermissionMode({
      ...(sessionOverride !== undefined ? { sessionOverride } : {}),
      ...(deps.options.permissionModeOverride !== undefined
        ? { cliOverride: deps.options.permissionModeOverride }
        : {}),
      configMode: deps.permissionModeFromConfig,
      ...(projectPath !== undefined ? { projectPath } : {}),
      projectTrusted,
    });
    if (childContext?.worktreePath && mode === 'ask-all') {
      return 'auto';
    }
    return mode;
  };
  const childWorktreePath = childContext?.worktreePath;
  const permissionGate = createHostToolAdmission({
    rules,
    getPermissionMode,
    ...(childWorktreePath !== undefined
      ? {
          autoApproveRecursiveRemove: async (command: string) => {
            // `ask-all` asked for every prompt; honor it for children too.
            const mode = getPermissionMode();
            if (mode !== 'auto') return false;
            return isWorktreeConfinedRecursiveRemove({
              command,
              worktreePath: childWorktreePath,
              evaluateStep: (step) =>
                evaluateBashPermission(step, mode, rules, childWorktreePath).decision,
            });
          },
        }
      : {}),
    getSessionAllowlist: (currentSessionId) => deps.sessionAllowlists.get(currentSessionId),
    requestPermission: (input) =>
      deps.requestPermission({
        sessionId,
        ...(projectPath !== undefined ? { projectPath } : {}),
        action: input.action,
        detail: input.detail,
        defaultDecision: input.defaultDecision,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    projectRoot: resolvePermissionProjectRoot(projectPath, getPiwinGeneralWorkspacePath(rootDir)),
    ...(projectPath !== undefined ? { projectPath } : {}),
    projectsFilePath: getPiwinProjectsPath(rootDir),
    // Host resource admission (`execution.minAvailableMemoryMiB`). Counts what
    // no other quota can see: the process tree one `bash` call forks.
    resourceGate: createToolResourceGate({
      getMinAvailableMemoryMiB: () =>
        normalizeExecutionConfig(config?.execution).minAvailableMemoryMiB,
      getReading: () => getSharedSystemMemoryMonitor().getLatest(),
    }),
    onDiagnostic: (message) => deps.push({ type: 'host/log', level: 'warn', message }),
  });
  deps.generationPermissionRuleRevisions.set(
    `${sessionId}\u0000${runtimeGenerationId}`,
    computePermissionRulesRevision(rules),
  );
  if (!mcpCapabilityBrief) {
    throw new Error(
      `MCP capability brief was not produced for ${sessionId}/${runtimeGenerationId}`,
    );
  }
  return { tools, permissionGate, mcpCapabilityBrief };
}

export function clearGenerationToolSurfaces(deps: HostRuntimeKernel, sessionId: string): void {
  const prefix = `${sessionId}\u0000`;
  for (const key of deps.generationToolSurfaces.keys()) {
    if (key.startsWith(prefix)) {
      deps.generationToolSurfaces.delete(key);
    }
  }
  for (const key of deps.generationMcpConfigs.keys()) {
    if (key.startsWith(prefix)) {
      deps.generationMcpConfigs.delete(key);
    }
  }
  for (const key of deps.generationMcpSnapshots.keys()) {
    if (key.startsWith(prefix)) {
      deps.generationMcpSnapshots.delete(key);
    }
  }
  for (const key of deps.generationSessionMcpOverrideKeys.keys()) {
    if (key.startsWith(prefix)) {
      deps.generationSessionMcpOverrideKeys.delete(key);
    }
  }
  for (const key of deps.generationPermissionRuleRevisions.keys()) {
    if (key.startsWith(prefix)) {
      deps.generationPermissionRuleRevisions.delete(key);
    }
  }
}

export function clearGenerationToolSurface(
  deps: HostRuntimeKernel,
  sessionId: string,
  runtimeGenerationId: string,
): void {
  const key = `${sessionId}\u0000${runtimeGenerationId}`;
  deps.generationToolSurfaces.delete(key);
  deps.generationMcpConfigs.delete(key);
  deps.generationMcpSnapshots.delete(key);
  deps.generationSessionMcpOverrideKeys.delete(key);
  deps.generationPermissionRuleRevisions.delete(key);
}

/**
 * Release the MCP runtime owned by one frozen tool surface before dropping
 * its in-memory inputs. Clearing only the maps would leak generation-scoped
 * MCP clients and their child processes.
 */
export async function releaseGenerationToolSurface(
  deps: HostRuntimeKernel,
  sessionId: string,
  runtimeGenerationId: string,
): Promise<void> {
  const key = `${sessionId}\u0000${runtimeGenerationId}`;
  const snapshot = deps.generationMcpSnapshots.get(key);
  deps.clearGenerationToolSurface(sessionId, runtimeGenerationId);
  if (!snapshot || !deps.mcpManager) {
    return;
  }
  try {
    await deps.mcpManager.releaseGenerationSnapshot(snapshot.generationId);
  } catch (error) {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `MCP generation snapshot cleanup failed for ${sessionId}/${runtimeGenerationId}: ${formatError(error)}`,
    });
  }
}

export async function releaseGenerationToolSurfaces(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<void> {
  const prefix = `${sessionId}\u0000`;
  const pendingSurfaces = [...deps.generationToolSurfaces.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, surface]) => surface);
  await Promise.allSettled(pendingSurfaces);
  const generationIds = [...deps.generationMcpSnapshots.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, snapshot]) => snapshot.generationId);
  deps.clearGenerationToolSurfaces(sessionId);
  if (!deps.mcpManager) {
    return;
  }
  const results = await Promise.allSettled(
    generationIds.map((generationId) => deps.mcpManager?.releaseGenerationSnapshot(generationId)),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `MCP generation snapshot cleanup failed for ${sessionId}: ${formatError(result.reason)}`,
      });
    }
  }
}

export function getGenerationMcpConfig(
  deps: HostRuntimeKernel,
  sessionId: string,
  runtimeGenerationId: string,
): McpConfigDocument {
  return (
    deps.generationMcpConfigs.get(`${sessionId}\u0000${runtimeGenerationId}`) ?? {
      mcpServers: {},
    }
  );
}

export async function getGenerationMcpCapabilityBrief(
  deps: HostRuntimeKernel,
  sessionId: string,
  runtimeGenerationId: string,
): Promise<McpCapabilityBrief> {
  const surface = deps.generationToolSurfaces.get(`${sessionId}\u0000${runtimeGenerationId}`);
  if (!surface) {
    throw new Error(
      `MCP capability brief surface is not registered: ${sessionId}/${runtimeGenerationId}`,
    );
  }
  return (await surface).mcpCapabilityBrief;
}
