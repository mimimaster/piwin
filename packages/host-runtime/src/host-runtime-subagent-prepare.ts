/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import type { CreateSessionInput } from '@piwin/contracts';
import { listProjects } from '@piwin/project';

import { getSessionRecord, buildCompactionSeedMessages } from '@piwin/session';
import { loadPiwinConfig } from './config-store.js';
import {
  getPiwinGeneralWorkspacePath,
  getPiwinProjectsPath,
  getPiwinRoot,
  getPiwinSessionIndexPath,
} from './paths.js';
import { descriptorsFromTools } from './tools/build-session-host-tools.js';
import { toolFamilyIndex } from './tools/tool-family-index.js';
import type {
  SubagentTaskPreparationInput,
  PreparedSubagentTask,
} from './subagent-orchestrator.js';
import { resolveSubagentChildPrompt } from './subagent-lifecycle-service.js';
import { resolveSubagentParentLocation } from './subagent-parent-scope.js';
import { compileBlueprintForWorker } from './blueprint-compiler.js';
import { isSubscriptionAccountUsable } from './resolve-chat-model.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';
import type { SubagentRuntimeSnapshot, BackendPreparedPrompt } from '@piwin/contracts';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';

export async function prepareSubagentTask(
  deps: HostRuntimeKernel,
  input: SubagentTaskPreparationInput,
): Promise<PreparedSubagentTask> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  let config = input.preflight?.config;
  if (!config) {
    try {
      config = await loadPiwinConfig(deps.options.piwinRoot);
    } catch {
      // Config load failure — use defaults. The blueprint compiler will
      // produce a minimal snapshot.
    }
  }
  const effectiveModel = input.task.model ?? input.preflight?.effectiveModel;

  const parentRecord = await getSessionRecord(
    getPiwinSessionIndexPath(rootDir),
    input.task.parentSessionId,
  );
  if (!parentRecord) {
    throw new Error(`subagent parent session not found: ${input.task.parentSessionId}`);
  }
  const parentLocation = resolveSubagentParentLocation(
    parentRecord,
    input.workspaceLease.mode,
    getPiwinGeneralWorkspacePath(rootDir),
  );

  // Build the CreateSessionInput for the child session.
  const subagentOptions = {
    mode: input.workspaceLease.mode,
    applyPolicy: input.task.applyPolicy ?? 'none',
    retainWorktree: input.task.retainWorktree === true,
    ...(input.task.profileId ? { profileId: input.task.profileId } : {}),
    ...(input.task.capabilities ? { capabilities: [...input.task.capabilities] } : {}),
    ...(input.task.skillIds ? { skillIds: [...input.task.skillIds] } : {}),
    ...(input.task.allowedOutputPaths
      ? { allowedOutputPaths: [...input.task.allowedOutputPaths] }
      : {}),
  } satisfies import('@piwin/contracts').SubagentSpawnOptions;
  const createInput: import('@piwin/contracts').CreateSessionInput = {
    scope: parentLocation.scope,
    sessionName: input.task.sessionName ?? `subagent-${input.task.id}`,
    ...(effectiveModel ? { model: effectiveModel } : {}),
    ...(input.task.thinkingLevel ? { thinkingLevel: input.task.thinkingLevel } : {}),
    parentSessionId: input.task.parentSessionId,
    task: input.task.task,
    subagent: subagentOptions,
    cwd: input.workspaceLease.cwd,
    runtimeSnapshot: {
      ...(input.task.profileId ? { profileId: input.task.profileId } : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(input.task.thinkingLevel ? { thinkingLevel: input.task.thinkingLevel } : {}),
      ...(input.task.capabilities ? { capabilities: [...input.task.capabilities] } : {}),
      ...(input.task.skillIds ? { skillIds: [...input.task.skillIds] } : {}),
      isolation: input.workspaceLease.mode,
      workingDirectory: input.workspaceLease.cwd,
    },
  };

  const hostTools = await deps.buildSessionHostToolsForSession(
    input.childSessionId,
    input.runtimeGenerationId,
    effectiveModel,
  );
  const rulesRevision = deps.generationPermissionRuleRevisions.get(
    `${input.childSessionId}\u0000${input.runtimeGenerationId}`,
  );
  const mcpCapabilityBrief = await deps.getGenerationMcpCapabilityBrief(
    input.childSessionId,
    input.runtimeGenerationId,
  );

  // Compile the blueprint for the worker. The blueprint includes the
  // capability snapshot, model, thinking level, and resource manifest.
  const subscriptionAccounts = await deps.subscriptionAuth?.chatResolveInput();
  const compiled = await compileBlueprintForWorker(createInput, {
    ...(deps.options.piwinRoot ? { piwinRoot: deps.options.piwinRoot } : {}),
    sessionId: input.childSessionId,
    runtimeGenerationId: input.runtimeGenerationId,
    allowInlineProviderSecrets: false,
    allowWorkerProviderSecretBootstrap: true,
    ...(effectiveModel ? { requiredProviderIds: [effectiveModel.providerId] } : {}),
    ...(subscriptionAccounts
      ? {
          subscriptionAccounts,
          usableSubscriptionProviderIds: subscriptionAccounts.accounts
            .filter((account) => isSubscriptionAccountUsable(account))
            .map((account) => account.providerId),
        }
      : {}),
    ...(config ? { config } : {}),
    ...(input.preflight
      ? {
          secretResolver: {
            resolveProviderSecret: async (provider) => {
              const apiKeyRef = provider.apiKeyRef?.trim();
              const resolved = input.preflight?.resolvedProviderSecrets.find(
                (entry) => entry.providerId === provider.id && entry.apiKeyRef === apiKeyRef,
              );
              if (!resolved) {
                throw new Error(
                  `Provider "${provider.id}" credential was not captured during preflight`,
                );
              }
              return resolved.value;
            },
          },
        }
      : {}),
    mcpConfig: deps.getGenerationMcpConfig(input.childSessionId, input.runtimeGenerationId),
    mcpCapabilityBrief,
    hostToolDescriptors: descriptorsFromTools(hostTools),
    hostToolFamilyIndex: toolFamilyIndex(hostTools),
    ...(rulesRevision !== undefined ? { rulesRevision } : {}),
    // Resolve trust from the project store so untrusted projects
    // cannot compile write/process/bash/delegate capabilities.
    ...(createInput.scope?.kind === 'project'
      ? {
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
        }
      : {}),
  });
  if (
    !deps.sessionHostToolPort?.restrictGeneration(
      input.childSessionId,
      input.runtimeGenerationId,
      compiled.sessionBlueprint.capabilitySnapshot.tools.hostTools.map((tool) => tool.name),
      compiled.sessionBlueprint.hostToolboxTargetNames,
      compiled.sessionBlueprint.capabilitySnapshot.tools.enabledFamilies.includes('mcp'),
    )
  ) {
    throw new Error(
      `compiled Host tool surface is not registered: ${input.childSessionId}/${input.runtimeGenerationId}`,
    );
  }

  // Build the prepared prompt from the task text (isolation prefix + optional
  // scheme report contract). Continuations skip the contract wrap.
  const preparedPrompt: BackendPreparedPrompt = {
    text: resolveSubagentChildPrompt(input.task),
    runId: input.taskRunId,
    ...(effectiveModel ? { model: effectiveModel } : {}),
    ...(input.task.thinkingLevel ? { thinkingLevel: input.task.thinkingLevel } : {}),
  };
  const seedMessages = input.task.continuationSessionId
    ? buildCompactionSeedMessages(
        await deps.loadTranscriptMessages(input.task.continuationSessionId),
      )
    : undefined;

  // Build the runtime snapshot for the child session.
  const runtimeSnapshot: SubagentRuntimeSnapshot = {
    ...(input.task.profileId ? { profileId: input.task.profileId } : {}),
    ...(effectiveModel ? { model: effectiveModel } : {}),
    ...(input.task.thinkingLevel ? { thinkingLevel: input.task.thinkingLevel } : {}),
    ...(input.task.capabilities ? { capabilities: [...input.task.capabilities] } : {}),
    ...(input.task.skillIds ? { skillIds: [...input.task.skillIds] } : {}),
    isolation: input.workspaceLease.mode,
    workingDirectory: input.workspaceLease.cwd,
  };

  return {
    runtimeSnapshot,
    sessionBlueprint: compiled.backendBlueprint,
    preparedPrompt,
    ...(seedMessages && seedMessages.length > 0 ? { seedMessages } : {}),
    // The compiled provider envelope is frozen before dispatch. The worker
    // task runner constructs model clients from it without reading settings.
    // `SerializableProviderRuntime` is structurally identical to the
    // contracts-level `SubagentProviderEnvelope`, so this is a safe pass.
    providers: compiled.providers.map((provider) => {
      if (provider.auth.kind === 'inline') {
        throw new Error(
          `Provider "${provider.providerId}" unexpectedly compiled inline auth for a worker`,
        );
      }
      return {
        providerId: provider.providerId,
        ...(provider.protocol !== undefined ? { protocol: provider.protocol } : {}),
        ...(provider.baseUrl !== undefined ? { baseUrl: provider.baseUrl } : {}),
        ...(provider.headers ? { headers: { ...provider.headers } } : {}),
        models: provider.models.map((model) => ({
          id: model.id,
          ...(model.label ? { label: model.label } : {}),
          ...(model.input ? { input: [...model.input] } : {}),
          ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
          ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
          ...(model.maxOutputTokens !== undefined
            ? { maxOutputTokens: model.maxOutputTokens }
            : {}),
        })),
        auth: provider.auth,
      };
    }),
    ...(compiled.providerSecrets ? { providerSecrets: compiled.providerSecrets } : {}),
  };
}

/**
 * ADR 0030 Phase D-3: create the SubagentRunSeam for the model-facing
 * piwin_subagent_run tool. The seam starts a batch with one task, waits
 * for completion, and merges the summary back.
 */
