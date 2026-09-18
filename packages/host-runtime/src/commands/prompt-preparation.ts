/**
 * Split from session-live-commands.ts — pure relocation, no behavior change.
 */

import { createHash, randomUUID } from 'node:crypto';
/**
 * Live session IPC: create/spawn/prompt/compact/export and sub-agent lifecycle.
 * HostRuntime provides SessionLiveContext (maps + ensureLiveSession/bindSession/…).
 */
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import type {
  AgentHost,
  CreateSessionInput,
  CreateSessionOptions,
  ExecutionRunRecord,
  RunTerminalCode,
  HostCommand,
  HostPush,
  HostResponse,
  ModelRef,
  ThinkingLevel,
  PermissionPreset,
  PiwinConfig,
  PromptInput,
  QueuedTurnRecord,
  RunInterventionRecord,
  SessionHandle,
  SessionCompactData,
  SessionCompactExportData,
  SessionCompactResult,
  SessionIndexRecord,
  SessionResumeData,
  SessionRunAcceptedData,
  SessionPauseAcceptedData,
  SessionPauseCheckpoint,
  SessionPauseCheckpointInput,
  SessionResumeRunAcceptedData,
  SessionTranscriptPageData,
  SessionTranscriptMessage,
  PlanExecutionMode,
} from '@piwin/contracts';
import {
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
  SESSION_TRANSCRIPT_WINDOW_DEFAULT_AFTER_ITEMS,
  SESSION_TRANSCRIPT_WINDOW_DEFAULT_BEFORE_ITEMS,
  formatError,
  isPauseContinueUtterance,
  readExplicitSkillIntent,
  wrapLiveDelegationForAgent,
  DEFAULT_PERMISSION_PRESET,
  resolvePermissionPreset,
  resolvePromptPermissionMode,
  mergeAgentModeIntoPrompt,
  resolveOrchestrationScheme,
  mergeOrchestrationSchemeIntoPrompt,
  OrchestrationSchemeError,
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  estimatePendingPromptTokens,
  readContextOccupiedTokens,
  resolveModelContextBudget,
  type ResolvedOrchestrationScheme,
  RUN_INTERVENTION_MAX_PENDING_BYTES_PER_RUN,
  RUN_INTERVENTION_MAX_PENDING_PER_RUN,
  RUN_INTERVENTION_MAX_TEXT_BYTES,
} from '@piwin/contracts';
import type { RunAbortReason } from '../run-abort-reason.js';
import {
  createPauseRequestedAbortReason,
  createSupersededByNewPromptAbortReason,
  createUserStopAbortReason,
  formatRunAbortReason,
} from '../run-abort-reason.js';
import {
  clearSessionPlan,
  createSessionRecord,
  createSubagentRunStore,
  streamTranscriptExport,
  getSessionRecord,
  listChildSessions,
  loadSessionPlan,
  mergeProductHistoryIntoPrompt,
  saveSessionPlan,
  exportCompactionMarkdown,
  buildCompactionSeedMessages,
  suggestSessionExportBasename,
  suggestCompactionExportBasename,
  upsertSessionRecord,
  readToolOutputSnapshot,
  openModelContextStore,
  PlanMutationError,
  type SessionTranscriptStore,
  updateSessionPlan,
} from '@piwin/session';
import { formatSideChatContextBlock, mergeSideChatContextIntoPrompt } from '@piwin/session';
import { redactToolText } from '@piwin/agent-host';
import { extractFileOpsFromUnknown, formatFilesTouchedBlock } from '../compaction-file-ops.js';
import { formatPlanForModelContext } from '../format-plan-context.js';
import { createProductShellSession } from '../product-shell-session.js';
import { createModelPromptAssembly, type ModelPromptAssembly } from '../model-context-assembly.js';
import { persistAndPushAssembly } from '../model-context-record.js';
import { resolvePromptContextRefs } from '../prompt/resolve-prompt-context-refs.js';
import { fail, ok } from '../response-helpers.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  getPiwinProjectsPath,
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionIndexPath,
  getPiwinSessionModelContextDatabasePath,
  getPiwinSessionPlanPath,
} from '../paths.js';
import { findRegisteredProjectRoot, loadProjectStore } from '@piwin/project';
import type { TranscriptRecorder } from '../transcript-recorder.js';
import { SessionRuntimeController } from '../sessions/session-runtime-controller.js';
import { createSessionMessageResponse } from '../session-message-response.js';
import {
  indexProjectPathForScope,
  resolveSessionLocation,
  scopeFromIndexRecord,
  workingDirectoryFromIndexRecord,
} from '../session-scope.js';
import { repairLegacySessionNames } from '../session-name-repair.js';
import { findEnabledModel } from '../provider-helpers.js';
import { activateSkillForPrompt } from './activate-skill-for-prompt.js';
import type { SessionLiveContext } from './session-live-context.js';
import { shouldInjectLiveWorkPreamble } from '../voice/live-work-preamble.js';
import { applyInlineArtifactLayout } from '../prompt/inline-artifact-layout.js';
import { resolveExplicitPlanExecutionMode } from './plan-execution-intent.js';

/** Build resolver deps with registered-project-root enforcement (security). */
export function createResolveRefsDeps(context: SessionLiveContext): {
  loadTranscriptMessages: (
    sessionId: string,
  ) => Promise<import('@piwin/contracts').SessionTranscriptMessage[]>;
  loadTranscriptMessage: (
    sessionId: string,
    messageId: string,
  ) => Promise<import('@piwin/contracts').SessionTranscriptMessage | undefined>;
  isRegisteredProjectRoot: (projectPath: string) => Promise<boolean>;
  onDiagnostic: (message: string) => void;
} {
  return {
    loadTranscriptMessages: context.loadTranscriptMessages,
    loadTranscriptMessage: async (sessionId, messageId) => {
      try {
        return await (await context.getTranscriptStore(sessionId)).getMessage(messageId);
      } catch {
        return undefined;
      }
    },
    onDiagnostic: (message) => {
      context.push({ type: 'host/log', level: 'warn', message });
    },
    isRegisteredProjectRoot: async (projectPath: string): Promise<boolean> => {
      try {
        const projectsPath = getPiwinProjectsPath(getPiwinRoot(context.piwinRoot));
        const document = await loadProjectStore(projectsPath);
        const matched = await findRegisteredProjectRoot(
          document.projects.map((project) => project.path),
          projectPath,
        );
        return matched !== undefined;
      } catch {
        return false;
      }
    },
  };
}

export type PromptCommand = Extract<HostCommand, { type: 'session/prompt' }>;

export const RESUME_CONTINUATION_PROMPT =
  'Continue the interrupted task from the current transcript and tool state. First inspect what has already been completed and any partial output; do not repeat successful side effects. Then continue only the unfinished work and report what remains.';

export const TURN_CONTINUATION_PROMPT =
  'The previous attempt ended before the deliverable was finished (truncated output or a provider failure after work already landed). Continue from the current transcript and tool state. First inspect what has already been completed, including generated mediaIds and partial artifacts. Do not repeat successful side effects. Do not regenerate media already produced. Do not embed image bytes, markdown images, or filesystem paths. Finish only the unfinished work.';

export function resolveResumePromptText(
  userText: string | undefined,
  interruptedSubagentRunIds: readonly string[] = [],
): string {
  let text = RESUME_CONTINUATION_PROMPT;
  if (interruptedSubagentRunIds.length > 0) {
    text +=
      `\n\nPausing cancelled these subagent runs before they finished: ${interruptedSubagentRunIds.join(', ')}. ` +
      'Their worktrees and partial results are retained. Before redoing that work, call ' +
      'piwin_subagent_wait with these runIds to read each final status and summary, then ' +
      'reuse what is usable and restart only what is missing.';
  }
  if (userText === undefined || isPauseContinueUtterance(userText)) {
    return text;
  }
  return `${text}\n\nAdditional user instruction:\n${userText.trim()}`;
}

class PromptPreparationCancelledError extends Error {
  constructor() {
    super('prompt preparation cancelled');
    this.name = 'PromptPreparationCancelledError';
  }
}

export function throwIfPromptPreparationAborted(context: SessionLiveContext, runId: string): void {
  if (context.getRunSignal(runId)?.aborted) {
    throw new PromptPreparationCancelledError();
  }
}

function isImageAttachment(attachment: NonNullable<PromptInput['attachments']>[number]): boolean {
  return (
    attachment.kind === 'media' &&
    (attachment.contentKind === 'image' ||
      (attachment.contentKind === undefined &&
        attachment.mimeType.toLowerCase().startsWith('image/')))
  );
}

function collectPreparedAttachmentContributions(
  assembly: ModelPromptAssembly,
  original: PromptInput,
  prepared: PromptInput,
): void {
  const originalAttachments = original.attachments ?? [];
  for (const attachment of originalAttachments) {
    if (attachment.kind === 'media') {
      assembly.add({
        kind: isImageAttachment(attachment) ? 'native-image' : 'attachment-text',
        label: attachment.mimeType,
        trustOrigin: 'user',
        hostPath: attachment.path,
      });
    } else {
      assembly.add({
        kind: 'web-element',
        label: 'Web element',
        trustOrigin: 'external-web',
        text: attachment.text,
      });
    }
  }
  if (prepared.text === original.text) {
    return;
  }
  const injected = prepared.text.endsWith(original.text)
    ? prepared.text.slice(0, Math.max(0, prepared.text.length - original.text.length)).trim()
    : prepared.text.startsWith(original.text)
      ? prepared.text.slice(original.text.length).trim()
      : '';
  if (injected.length === 0) {
    return;
  }
  const preparedKeptNativeImage =
    prepared.attachments?.some((attachment) => isImageAttachment(attachment)) === true;
  const hadImage = originalAttachments.some((attachment) => isImageAttachment(attachment));
  assembly.add({
    kind: hadImage && !preparedKeptNativeImage ? 'vision-description' : 'attachment-text',
    label: hadImage && !preparedKeptNativeImage ? 'Vision / path injection' : 'Attachment text',
    trustOrigin: 'piwin',
    text: injected,
  });
}

function promptInputFromStoredUser(
  stored: SessionTranscriptMessage,
  commandInput: PromptInput,
): PromptInput {
  const next: PromptInput = { ...commandInput, text: stored.text };
  delete next.clientMessageId;
  if (stored.attachments && stored.attachments.length > 0) {
    next.attachments = [...stored.attachments];
  } else {
    delete next.attachments;
  }
  if (stored.contextRefs && stored.contextRefs.length > 0) {
    next.contextRefs = stored.contextRefs.map((ref) => ({ ...ref }));
  } else {
    delete next.contextRefs;
  }
  const storedSkillId = stored.skillId?.trim();
  if (storedSkillId) {
    next.skillId = storedSkillId;
  } else {
    delete next.skillId;
  }
  return next;
}

/** Structured skillId first; then stored row; then explicit `/skill` or wrapper text. */
export function resolvePromptSkillId(input: {
  skillId?: string;
  text: string;
  storedSkillId?: string;
}): string | undefined {
  const fromInput = input.skillId?.trim();
  if (fromInput) {
    return fromInput;
  }
  const fromStored = input.storedSkillId?.trim();
  if (fromStored) {
    return fromStored;
  }
  return readExplicitSkillIntent(input.text)?.skillId;
}

export async function preparePromptInput(
  context: SessionLiveContext,
  command: PromptCommand,
  run: ExecutionRunRecord,
  assembly: ModelPromptAssembly,
  conversationChat: boolean,
  desired?: {
    desiredModel: ModelRef | undefined;
    desiredThinkingLevel: ThinkingLevel | undefined;
  },
): Promise<{ promptInput: PromptInput; userMessageId?: string }> {
  throwIfPromptPreparationAborted(context, run.runId);

  // Persist ordinary user text + attachments before path-injection rewrite.
  // A resume continuation is Host-authored and must not create a fake user row.
  // Stamp a stable clientMessageId so the assembly capsule can bind to the
  // exact product user row after reload.
  let userMessageId: string | undefined;
  // Retry reuses the stored user row (ADR 0064). Client text is ignored so a
  // stale or empty payload cannot drift the prompt away from what is stored.
  const retryUserMessageId = command.input.retryUserMessageId?.trim();
  let promptSource = command.input;
  if (retryUserMessageId) {
    const stored = await context
      .getTranscriptStore(command.sessionId)
      .then((store) => store.getMessage(retryUserMessageId));
    if (stored === undefined || stored.role !== 'user') {
      throw new Error(`retry-target-not-found: ${retryUserMessageId}`);
    }
    userMessageId = retryUserMessageId;
    promptSource = promptInputFromStoredUser(stored, command.input);
  } else if (command.input.source === 'queued-turn') {
    userMessageId = command.input.clientMessageId?.trim() || undefined;
  } else if (command.input.source !== 'resume' && command.input.source !== 'continuation') {
    userMessageId = command.input.clientMessageId?.trim() || randomUUID();
    try {
      await context.recordUserPrompt(command.sessionId, {
        ...command.input,
        clientMessageId: userMessageId,
      });
    } catch (error) {
      const message = formatError(error);
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `transcript user write failed: ${message}`,
      });
    }
  }
  throwIfPromptPreparationAborted(context, run.runId);

  const hasImage =
    promptSource.attachments?.some(
      (item) =>
        item.kind === 'media' &&
        (item.contentKind === 'image' ||
          (item.contentKind === undefined && item.mimeType.toLowerCase().startsWith('image/'))),
    ) === true;
  if (hasImage) {
    // Surface image preparation while vision delegation may run inside buildModelPromptInput.
    context.updateRunPhase(run.runId, 'preparing', 'Preparing image…');
  }

  // Always clone before model-facing rewrites. buildModelPromptInput may return
  // the same object when there are no attachments; mutating that would poison
  // command.input (transcript path, touchSession preview, last-prompt text).
  const preparedFromHost = await context.buildModelPromptInput(
    promptSource,
    context.getRunSignal(run.runId),
  );
  const promptInput: PromptInput = {
    ...preparedFromHost,
    text:
      promptSource.source === 'continuation'
        ? TURN_CONTINUATION_PROMPT
        : promptSource.source === 'voice-delegation'
          ? wrapLiveDelegationForAgent(preparedFromHost.text, {
              firstForCall: shouldInjectLiveWorkPreamble(promptSource.voiceCallId),
            })
          : preparedFromHost.text,
    ...(preparedFromHost.attachments ? { attachments: [...preparedFromHost.attachments] } : {}),
  };
  if (retryUserMessageId !== undefined && userMessageId !== undefined) {
    // Retry reuses the durable user row. Keep its id on the prepared input so
    // a cold-start product-history fallback can exclude that row just like a
    // newly submitted prompt; otherwise the retry is sent twice after reload.
    promptInput.clientMessageId = userMessageId;
  }
  if (command.input.source === 'continuation') {
    assembly.add({
      kind: 'user',
      label: 'Continue',
      trustOrigin: 'piwin',
      text: TURN_CONTINUATION_PROMPT,
    });
  } else {
    assembly.add({
      kind: 'user',
      label: 'User',
      trustOrigin: 'user',
      text: promptSource.text,
    });
  }
  collectPreparedAttachmentContributions(assembly, promptSource, preparedFromHost);
  if (promptInput.inlineArtifactWidthPx !== undefined) {
    const config = await context.loadConfig();
    applyInlineArtifactLayout(promptInput, config.artifact?.enabled === true, assembly);
  }
  throwIfPromptPreparationAborted(context, run.runId);

  // Explicit slash/mention Skill activation (Agent Skills Tier-2): inject the
  // SKILL.md body into the model-facing prompt. Transcript keeps the client
  // text recorded above; discovery catalog remains separate.
  // Resolve structured input first, then the stored explicit intent captured
  // by the slash parser. This keeps retries and queued turns deterministic
  // while allowing Conversation / general sessions to activate a skill too.
  const skillId = resolvePromptSkillId({
    ...(promptSource.skillId ? { skillId: promptSource.skillId } : {}),
    text: promptSource.text,
  });
  if (skillId) {
    const rootDir = getPiwinRoot(context.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const sessionRecord = await getSessionRecord(indexPath, command.sessionId);
    const scope = sessionRecord ? scopeFromIndexRecord(sessionRecord) : undefined;
    const projectPath = scope?.kind === 'project' ? scope.projectPath : undefined;
    const activated = await activateSkillForPrompt({
      text: promptInput.text,
      skillId,
      ...(context.piwinRoot ? { piwinRoot: context.piwinRoot } : {}),
      ...(projectPath ? { projectPath } : {}),
    });
    throwIfPromptPreparationAborted(context, run.runId);
    if (activated.ok) {
      promptInput.text = activated.text;
      assembly.add({
        kind: 'skill',
        label: `Skill · ${activated.skillName}`,
        trustOrigin: 'piwin',
        text: activated.skillBody,
      });
    } else {
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `skill activation failed (${skillId}): ${activated.reason}`,
      });
    }
  }

  // CHT-303: conversations never delegate. Agent sessions still honor an
  // explicit disabled flag; everything else stays auto.
  context.setRunDelegationMode?.(
    run.runId,
    conversationChat || command.input.delegationMode === 'disabled' ? 'disabled' : 'auto',
  );

  // SIDE §7.5(5)/§9.2: inject the side chat's inherited context snapshot
  // whenever the stored context version is newer than the version already
  // injected into this session. This covers the first prompt after
  // open/resume (no injected version yet) AND every explicit sync afterwards —
  // a version-stable session is never re-injected. The side chat's own
  // transcript is handled separately by product-history injection.
  const sideChatSnapshot = await context.loadSideChatSnapshot(command.sessionId);
  throwIfPromptPreparationAborted(context, run.runId);
  if (sideChatSnapshot) {
    const injectedVersion = context.sideChatSnapshotInjectedVersions.get(command.sessionId);
    if (injectedVersion === undefined || injectedVersion < sideChatSnapshot.version) {
      const sideBlock = formatSideChatContextBlock(sideChatSnapshot);
      promptInput.text = mergeSideChatContextIntoPrompt(sideBlock, promptInput.text);
      // SIDE §7.2: refs captured at open/sync are part of the shared context —
      // resolve them alongside the snapshot block on injection. Commit the
      // injected version only after resolution + cancellation checks succeed,
      // so a failed/cancelled preparation retries the same version next turn.
      if (sideChatSnapshot.refs.length > 0) {
        const refText = await resolvePromptContextRefs(
          createResolveRefsDeps(context),
          sideChatSnapshot.refs,
        );
        throwIfPromptPreparationAborted(context, run.runId);
        if (refText) {
          promptInput.text = `${refText}\n\n${promptInput.text}`;
          assembly.add({
            kind: 'context-ref',
            label: 'Side chat refs',
            trustOrigin: 'piwin',
            text: refText,
          });
        }
      } else {
        throwIfPromptPreparationAborted(context, run.runId);
      }
      context.sideChatSnapshotInjectedVersions.set(command.sessionId, sideChatSnapshot.version);
      assembly.add({
        kind: 'side-chat',
        label: 'Side chat context',
        trustOrigin: 'piwin',
        text: sideBlock,
      });
    }
  }
  throwIfPromptPreparationAborted(context, run.runId);

  // SIDE §8.2: resolve handoff context refs (side-chat-message / main-message
  // / file / diff / terminal-output / error) into the model prompt without
  // mutating the recorded user transcript.
  if (promptSource.contextRefs && promptSource.contextRefs.length > 0) {
    try {
      const resolvedContext = await resolvePromptContextRefs(
        createResolveRefsDeps(context),
        promptSource.contextRefs,
      );
      if (resolvedContext) {
        promptInput.text = `${resolvedContext}\n\n${promptInput.text}`;
        assembly.add({
          kind: 'context-ref',
          label: 'Context refs',
          trustOrigin: 'user',
          text: resolvedContext,
        });
      }
    } catch (error) {
      const message = formatError(error);
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `context ref resolve failed: ${message}`,
      });
    }
  }
  throwIfPromptPreparationAborted(context, run.runId);

  // CHT-304/305: Agent increments stay on the Project/Side Chat path.
  // Conversations ignore stale agent-only fields and clear any leftover
  // permission override so a previous plan/ask turn cannot leak.
  if (conversationChat) {
    context.clearSessionPermissionOverride(command.sessionId);
  } else {
    await applyAgentPromptContext(context, command, run, assembly, promptInput, promptSource.text);
  }

  // ADR 0026: concisePrompt injection retired with walkthrough generation.
  throwIfPromptPreparationAborted(context, run.runId);
  if (command.input.source !== 'continuation') {
    context.sessionLastPromptText.set(command.sessionId, promptSource.text);
  }
  if (promptInput.model === undefined && desired?.desiredModel !== undefined) {
    promptInput.model = desired.desiredModel;
  }
  if (promptInput.thinkingLevel === undefined && desired?.desiredThinkingLevel !== undefined) {
    promptInput.thinkingLevel = desired.desiredThinkingLevel;
  }
  if (promptInput.model !== undefined) {
    context.sessionModels.set(command.sessionId, promptInput.model);
  }
  if (promptInput.thinkingLevel !== undefined) {
    context.sessionThinkingLevels.set(command.sessionId, promptInput.thinkingLevel);
  }
  // Index is desired composer state. Rewrite it only for explicit picker/typed
  // sends — voice-delegation and other omitted-model turns must not persist.
  if (command.input.model !== undefined || command.input.thinkingLevel !== undefined) {
    await persistSessionComposerProfile(context, command.sessionId, {
      ...(command.input.model !== undefined ? { model: command.input.model } : {}),
      ...(command.input.thinkingLevel !== undefined
        ? { thinkingLevel: command.input.thinkingLevel }
        : {}),
    });
  }
  throwIfPromptPreparationAborted(context, run.runId);
  return userMessageId === undefined ? { promptInput } : { promptInput, userMessageId };
}

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
async function applyAgentPromptContext(
  context: SessionLiveContext,
  command: PromptCommand,
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

/**
 * ADR 0040 §7(6): inject bounded product history into the model prompt exactly
 * once for a reconstructed runtime generation. Called after cold activation so
 * the marker set by activation is honored; later turns reuse the backend's own
 * conversation state and never see duplicate history.
 */
export async function injectProductHistoryOnce(
  context: SessionLiveContext,
  sessionId: string,
  promptInput: PromptInput,
): Promise<void> {
  if (!context.needsProductHistoryInjection(sessionId)) {
    return;
  }
  try {
    const store = await context.getTranscriptStore(sessionId);
    const historyRows = await store.buildHistoryWindow({
      maxMessages: 40,
      maxChars: 24_000,
      ...(promptInput.clientMessageId !== undefined
        ? { excludeMessageId: promptInput.clientMessageId }
        : {}),
    });
    const history = await formatBoundedHistoryWithContext(context, historyRows);
    if (history) {
      promptInput.text = mergeProductHistoryIntoPrompt(history, promptInput.text);
    }
  } catch (error) {
    const message = formatError(error);
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `product history inject failed: ${message}`,
    });
  }
  context.markProductHistoryInjected(sessionId);
}

/**
 * Cold-start model history rebuild. User rows keep their original text; each
 * persisted structured context ref is resolved again into a labeled block so
 * the reconstructed generation sees the same referenced content without the
 * transcript ever storing resolved bodies.
 */
async function formatBoundedHistoryWithContext(
  context: SessionLiveContext,
  rows: ReadonlyArray<{
    role: string;
    text: string;
    contextRefs?: import('@piwin/contracts').PromptContextRef[] | undefined;
  }>,
): Promise<string> {
  if (rows.length === 0) {
    return '';
  }
  const lines = [
    '[piwin-product-history]',
    'Prior conversation (product transcript; not Pi JSONL):',
  ];
  for (const row of rows) {
    const role = row.role === 'user' ? 'User' : row.role === 'assistant' ? 'Assistant' : 'System';
    lines.push(`${role}: ${row.text.trim()}`);
    if (row.role === 'user' && row.contextRefs && row.contextRefs.length > 0) {
      try {
        const resolvedContext = await resolvePromptContextRefs(
          createResolveRefsDeps(context),
          row.contextRefs,
        );
        if (resolvedContext) {
          lines.push(resolvedContext);
        }
      } catch (error) {
        context.push({
          type: 'host/log',
          level: 'warn',
          message: `context ref resolve failed: ${formatError(error)}`,
        });
      }
    }
  }
  lines.push('[/piwin-product-history]');
  return lines.join('\n');
}

/**
 * Persist the last composer model/thinking onto the product session index so
 * resume and session switch can restore them after process restart.
 */
export async function persistSessionComposerProfile(
  context: Pick<SessionLiveContext, 'piwinRoot'>,
  sessionId: string,
  profile: { model?: ModelRef; thinkingLevel?: ThinkingLevel },
): Promise<void> {
  if (!profile.model && profile.thinkingLevel === undefined) {
    return;
  }
  const rootDir = getPiwinRoot(context.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const record = await getSessionRecord(indexPath, sessionId);
  if (!record) {
    return;
  }
  let changed = false;
  if (profile.model) {
    const previous = record.model;
    const sameModel =
      previous &&
      previous.protocol === profile.model.protocol &&
      previous.providerId === profile.model.providerId &&
      previous.modelId === profile.model.modelId;
    if (!sameModel) {
      record.model = profile.model;
      changed = true;
    }
  }
  if (profile.thinkingLevel !== undefined && record.thinkingLevel !== profile.thinkingLevel) {
    record.thinkingLevel = profile.thinkingLevel;
    changed = true;
  }
  if (!changed) {
    return;
  }
  record.updatedAt = new Date().toISOString();
  await upsertSessionRecord(indexPath, record);
}

/** Recover the last assistant model snapshot from transcript (legacy sessions). */
export function recoverModelFromTranscript(
  messages: readonly SessionTranscriptMessage[],
): ModelRef | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.model) {
      return message.model;
    }
  }
  return undefined;
}

export function listKnownChatModelKeys(config: PiwinConfig): string[] {
  return (config.providers ?? [])
    .filter((provider) => isProviderEnabled(provider))
    .flatMap((provider) =>
      provider.models
        .filter((model) => isModelEnabled(model) && modelSupportsCapability(model, 'chat'))
        .map((model) => `${provider.id}::${model.id}`),
    );
}
