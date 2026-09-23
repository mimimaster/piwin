import type { ExecutionRunRecord, PermissionPreset, PromptInput } from '@piwin/contracts';
import {
  DEFAULT_PERMISSION_PRESET,
  formatError,
  mergeAgentModeIntoPrompt,
  mergeOrchestrationSchemeIntoPrompt,
  resolveOrchestrationScheme,
  resolvePermissionPreset,
  resolvePromptPermissionMode,
} from '@piwin/contracts';
import { PlanMutationError, loadSessionPlan, updateSessionPlan } from '@piwin/session';
import { formatPlanForModelContext } from '../format-plan-context.js';
import type { ModelPromptAssembly } from '../model-context-assembly.js';
import { getPiwinRoot, getPiwinSessionPlanPath } from '../paths.js';
import { listKnownChatModelKeys } from '../provider-helpers.js';
import { resolveExplicitPlanExecutionMode } from './plan-execution-intent.js';
import { throwIfPromptPreparationAborted } from './prompt-preparation-abort.js';
import type { SessionLiveContext } from './session-live-context.js';

/**
 * The prompt-command shape this builder reads. Narrower than `PromptCommand`
 * on purpose: the preparation entry point depends on this module, so this
 * module must not depend back on it.
 */
export type AgentPromptCommand = {
  sessionId: string;
  input: PromptInput;
};

/**
 * Host-internal continuations omit composer preset/agentMode. Skip
 * applyPromptPermissionOverride so an existing Ask/Auto override is kept
 * instead of clearing back to config (possibly YOLO).
 */
export function shouldPreserveSessionPermissionOverride(
  input: Pick<PromptInput, 'permissionPreset' | 'agentMode' | 'source'>,
): boolean {
  if (input.permissionPreset !== undefined || input.agentMode !== undefined) {
    return false;
  }
  return (
    input.source === 'voice-delegation' ||
    input.source === 'queued-turn' ||
    input.source === 'resume' ||
    input.source === 'continuation'
  );
}

/** Apply composer Run Mode + agent-mode floor to the session admission gate. */
export function applyPromptPermissionOverride(
  context: Pick<
    SessionLiveContext,
    'setSessionPermissionOverride' | 'clearSessionPermissionOverride'
  >,
  input: {
    sessionId: string;
    permissionPreset?: PromptInput['permissionPreset'];
    agentMode?: PromptInput['agentMode'];
    configPreset: PermissionPreset;
  },
): void {
  const mode = resolvePromptPermissionMode({
    configPreset: input.configPreset,
    ...(input.permissionPreset !== undefined ? { permissionPreset: input.permissionPreset } : {}),
    ...(input.agentMode !== undefined ? { agentMode: input.agentMode } : {}),
  });
  if (mode === undefined) {
    context.clearSessionPermissionOverride(input.sessionId);
    return;
  }
  context.setSessionPermissionOverride(input.sessionId, mode);
}

/**
 * Project / Side Chat increments: permission floor, agent-mode contract,
 * orchestration preamble, active plan, and files-touched. Conversation
 * never enters this function (CHT-304).
 */
export async function applyAgentPromptContext(
  context: SessionLiveContext,
  command: AgentPromptCommand,
  run: ExecutionRunRecord,
  assembly: ModelPromptAssembly,
  promptInput: PromptInput,
  promptText: string,
): Promise<void> {
  // Composer Run Mode (permissionPreset) is session-level and must override
  // config YOLO. Plan/Ask agent modes still raise the floor via resolvePreset.
  // Host-internal sources that omit both fields keep the live override.
  const agentMode = command.input.agentMode;
  if (!shouldPreserveSessionPermissionOverride(command.input)) {
    try {
      const config = await context.loadConfig();
      applyPromptPermissionOverride(context, {
        sessionId: command.sessionId,
        configPreset: resolvePermissionPreset(config.permissions),
        ...(command.input.permissionPreset !== undefined
          ? { permissionPreset: command.input.permissionPreset }
          : {}),
        ...(agentMode !== undefined ? { agentMode } : {}),
      });
    } catch {
      if (command.input.permissionPreset !== undefined) {
        applyPromptPermissionOverride(context, {
          sessionId: command.sessionId,
          permissionPreset: command.input.permissionPreset,
          configPreset: DEFAULT_PERMISSION_PRESET,
          ...(agentMode !== undefined ? { agentMode } : {}),
        });
      }
    }
  }

  // Agent mode operating contract: model-facing only. Transcript already
  // recorded the original command.input (user text only) so naming stays clean.
  if (command.input.agentMode) {
    const before = promptInput.text;
    promptInput.text = mergeAgentModeIntoPrompt(command.input.agentMode, promptInput.text);
    if (promptInput.text !== before) {
      assembly.add({
        kind: 'agent-mode',
        label: `Agent mode ${command.input.agentMode}`,
        trustOrigin: 'piwin',
        text: promptInput.text.slice(0, Math.max(0, promptInput.text.length - before.length)),
      });
    }
  }

  // ORCH: per-send orchestration scheme — inject model-facing preamble only.
  // Transcript already recorded original command.input (user text only).
  const schemeIdRaw = command.input.orchestrationSchemeId;
  if (schemeIdRaw && schemeIdRaw.trim() && schemeIdRaw.trim() !== 'off') {
    const config = await context.loadConfig();
    const knownProfileIds = await context.listKnownSubagentProfileIds();
    const subagents = config.subagents;
    const resolved = resolveOrchestrationScheme(
      {
        schemes: subagents?.schemes,
        maxConcurrency: subagents?.maxConcurrency,
        maxTasksPerRun: subagents?.maxTasksPerRun,
      },
      schemeIdRaw,
      {
        knownProfileIds,
        knownModelKeys: listKnownChatModelKeys(config),
        globalMaxConcurrency: subagents?.maxConcurrency,
        globalMaxTasksPerRun: subagents?.maxTasksPerRun,
      },
    );
    if (resolved) {
      context.setRunOrchestrationScheme(run.runId, resolved);
      const beforeOrch = promptInput.text;
      promptInput.text = mergeOrchestrationSchemeIntoPrompt(resolved, promptInput.text);
      if (promptInput.text !== beforeOrch) {
        assembly.add({
          kind: 'orchestration',
          label: resolved.scheme.name,
          trustOrigin: 'piwin',
          text: promptInput.text.slice(0, Math.max(0, promptInput.text.length - beforeOrch.length)),
        });
      }
    }
  } else {
    context.setRunOrchestrationScheme(run.runId, undefined);
  }

  const planPath = getPiwinSessionPlanPath(getPiwinRoot(context.piwinRoot), command.sessionId);
  let activePlan: Awaited<ReturnType<typeof loadSessionPlan>> = null;
  try {
    activePlan = await loadSessionPlan(planPath);
  } catch (error) {
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `session plan load failed: ${formatError(error)}`,
    });
  }
  throwIfPromptPreparationAborted(context, run.runId);

  // Composer and card share this path: only an explicit one-mode reply
  // (inline / subagent / 当前会话执行 / 使用子代理执行) approves a draft.
  // Later turns reuse the stored mode. "执行一下" is not a mode.
  const explicitPlanMode = resolveExplicitPlanExecutionMode(promptText);
  const selectedPlanMode =
    explicitPlanMode ??
    (activePlan && (activePlan.status === 'approved' || activePlan.status === 'executing')
      ? activePlan.execution?.mode
      : undefined);

  if (activePlan?.status === 'draft' && explicitPlanMode !== undefined) {
    const draftPlanId = activePlan.id;
    let approvedHere = false;
    try {
      const selectedPlan = await updateSessionPlan(planPath, (current) => {
        if (current === null || current.id !== draftPlanId || current.status !== 'draft') {
          return current;
        }
        approvedHere = true;
        return {
          ...current,
          status: 'approved' as const,
          updatedAt: new Date().toISOString(),
          execution: {
            ...(current.execution ?? {
              sessionId: command.sessionId,
              planId: current.id,
              status: 'idle' as const,
              childSessionIds: [],
            }),
            sessionId: command.sessionId,
            planId: current.id,
            mode: explicitPlanMode,
          },
        };
      });
      if (selectedPlan?.id === draftPlanId && selectedPlan.status === 'approved') {
        activePlan = selectedPlan;
        if (approvedHere) {
          context.push({ type: 'plan/updated', sessionId: command.sessionId, plan: selectedPlan });
        }
      }
    } catch (error) {
      const message = error instanceof PlanMutationError ? error.message : formatError(error);
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `explicit plan mode approval failed: ${message}`,
      });
    }
  }

  if (activePlan && (activePlan.status === 'approved' || activePlan.status === 'executing')) {
    const modeInstruction =
      selectedPlanMode === 'subagent-driven'
        ? 'Execution mode: delegate eligible plan steps to subagents, then summarize and verify their results.'
        : selectedPlanMode === 'inline'
          ? 'Execution mode: execute the plan directly in this session; do not spawn implementation subagents.'
          : undefined;
    const planText = [
      formatPlanForModelContext(activePlan),
      `Plan file: ${planPath}`,
      ...(modeInstruction !== undefined ? [modeInstruction] : []),
    ].join(String.fromCharCode(10));
    promptInput.text = `${planText}\n\n${promptInput.text}`;
    assembly.add({
      kind: 'active-plan',
      label: activePlan.title ?? 'Active plan',
      trustOrigin: 'piwin',
      text: planText,
    });
  }

  throwIfPromptPreparationAborted(context, run.runId);

  const filesTouched = context.sessionFilesTouched.get(command.sessionId);
  if (filesTouched) {
    promptInput.text = `${filesTouched}\n\n${promptInput.text}`;
    assembly.add({
      kind: 'files-touched',
      label: 'Files touched',
      trustOrigin: 'piwin',
      text: filesTouched,
    });
  }
}
