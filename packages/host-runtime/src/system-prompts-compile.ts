/**
 * System-prompt compilation and status summary helpers for host-runtime.
 */
import { createHash } from 'node:crypto';
import type {
  BuiltinSystemPromptSlotId,
  BuiltinSystemPromptStackConfig,
  CreateSessionInput,
  PiwinConfig,
  ResolvedSessionLocation,
  ResolvedSystemPromptSourceKind,
  SystemPromptMode,
} from '@piwin/contracts';
import {
  compileBuiltinSystemPromptStackContent,
  formatSystemPromptFileStack,
  isBuiltinSystemPromptStackCustomized,
  readBuiltinSystemPromptStack,
  readBuiltinSystemPromptValue,
  resolveActiveSystemPromptSelection,
} from '@piwin/contracts';
import { getSessionRecord } from '@piwin/session';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { readSystemPromptFiles } from './system-prompt-files.js';

export type SystemPromptSurfaceSummary = {
  presetId?: string;
  presetName?: string;
  presetMode?: SystemPromptMode;
  sourceKind: ResolvedSystemPromptSourceKind;
  builtinModified: boolean;
  missingPresetId?: string;
  missingFilePaths?: string[];
};

export type ResolvedBuiltinSystemPrompt = {
  slotId: BuiltinSystemPromptSlotId;
  stack: BuiltinSystemPromptStackConfig;
  isCustomized: boolean;
  effectiveContent: string;
  missingFilePaths: string[];
};

export type CompiledSystemPromptOverlay = {
  baseAgentPrompt: string | undefined;
  baseConversationPrompt: string | undefined;
  artifactDecisionPrompt?: string;
  presetAppendPrompt?: string;
  systemPromptOverride?: string;
  summary: SystemPromptSurfaceSummary;
  revisionSeed: string;
};

export async function resolveBuiltinSystemPrompt(params: {
  config: PiwinConfig | null | undefined;
  slotId: BuiltinSystemPromptSlotId;
  piwinRoot?: string | undefined;
  projectPath?: string | undefined;
}): Promise<ResolvedBuiltinSystemPrompt> {
  const baseValue = readBuiltinSystemPromptValue(params.config, params.slotId);
  const stack = readBuiltinSystemPromptStack(params.config, params.slotId);
  const validContents: string[] = [];
  const missingFilePaths: string[] = [];

  if (stack.filePaths.length > 0) {
    const readResult = await readSystemPromptFiles({
      paths: stack.filePaths,
      piwinRoot: params.piwinRoot,
      projectPath: params.projectPath,
    });
    for (const item of readResult.files) {
      if (!item.exists || item.error) {
        missingFilePaths.push(item.path);
        continue;
      }
      if (item.content.trim().length > 0) {
        validContents.push(item.content);
      }
    }
  }

  const effectiveContent = compileBuiltinSystemPromptStackContent({
    baseContent: baseValue.effectiveContent,
    stack,
    fileContents: validContents,
  });
  const isCustomized = baseValue.isOverridden || isBuiltinSystemPromptStackCustomized(stack);

  return {
    slotId: params.slotId,
    stack,
    isCustomized,
    effectiveContent,
    missingFilePaths,
  };
}

export async function loadSessionSystemPromptPresetId(
  piwinRoot: string | undefined,
  sessionId: string | undefined,
): Promise<string | undefined> {
  if (!sessionId) return undefined;
  const record = await getSessionRecord(
    getPiwinSessionIndexPath(getPiwinRoot(piwinRoot)),
    sessionId,
  );
  return record?.systemPromptPresetId;
}

export async function resolveCompiledSystemPromptOverlay(params: {
  config: PiwinConfig;
  input: CreateSessionInput;
  location: ResolvedSessionLocation;
  isConversation: boolean;
  sessionPresetId?: string | undefined;
  piwinRoot?: string | undefined;
}): Promise<CompiledSystemPromptOverlay> {
  const { config, input, location, isConversation } = params;
  const isolated = Boolean(input.parentSessionId) || input.sessionKind === 'side-chat';

  const projectPath =
    location.scope.kind === 'project' ? location.scope.projectPath : undefined;

  const [agentDefault, agentGoal, conversationChat, artifactDecision] = await Promise.all([
    resolveBuiltinSystemPrompt({
      config,
      slotId: 'agent.default',
      piwinRoot: params.piwinRoot,
      projectPath,
    }),
    resolveBuiltinSystemPrompt({
      config,
      slotId: 'agent.goal',
      piwinRoot: params.piwinRoot,
      projectPath,
    }),
    resolveBuiltinSystemPrompt({
      config,
      slotId: 'conversation.chat',
      piwinRoot: params.piwinRoot,
      projectPath,
    }),
    resolveBuiltinSystemPrompt({
      config,
      slotId: 'artifact.decision',
      piwinRoot: params.piwinRoot,
      projectPath,
    }),
  ]);
  const builtinModified = isConversation
    ? conversationChat.isCustomized || artifactDecision.isCustomized
    : agentDefault.isCustomized || agentGoal.isCustomized || artifactDecision.isCustomized;

  const selection = isolated
    ? { sourceKind: 'builtin' as const, effectiveSelectionId: '__builtin__' }
    : resolveActiveSystemPromptSelection({
        config,
        projectPath,
        sessionPresetId: params.sessionPresetId ?? input.systemPromptPresetId,
      });

  const activePreset = selection.preset;
  let compiledPresetContent = '';
  const presetMissingPaths: string[] = [];

  if (activePreset && activePreset.filePaths.length > 0) {
    const readResult = await readSystemPromptFiles({
      paths: activePreset.filePaths,
      piwinRoot: params.piwinRoot,
      projectPath,
    });
    const validContents: string[] = [];
    for (const item of readResult.files) {
      if (!item.exists || item.error) {
        presetMissingPaths.push(item.path);
        continue;
      }
      if (item.content.trim().length > 0) {
        validContents.push(item.content);
      }
    }
    compiledPresetContent = formatSystemPromptFileStack(validContents);
  }

  // Safety fallback: if a `replace` preset has all referenced files missing or
  // empty, retain built-in contracts so tools/safety prompts are never wiped out.
  const hasCompiledContent = compiledPresetContent.length > 0;
  const isReplace = activePreset?.mode === 'replace' && hasCompiledContent;
  const isAppend = activePreset?.mode === 'append' && hasCompiledContent;

  const missingFilePaths = Array.from(
    new Set([
      ...(isConversation ? conversationChat.missingFilePaths : agentDefault.missingFilePaths),
      ...(isConversation ? [] : agentGoal.missingFilePaths),
      ...artifactDecision.missingFilePaths,
      ...presetMissingPaths,
    ]),
  );

  const revisionSeed = createHash('sha256')
    .update(
      JSON.stringify({
        isConversation,
        isolated,
        agentDefault: agentDefault.effectiveContent,
        agentDefaultStack: agentDefault.stack,
        agentGoal: agentGoal.effectiveContent,
        agentGoalStack: agentGoal.stack,
        conversationChat: conversationChat.effectiveContent,
        conversationChatStack: conversationChat.stack,
        artifactDecision: artifactDecision.effectiveContent,
        artifactDecisionStack: artifactDecision.stack,
        preset: activePreset
          ? {
              id: activePreset.id,
              mode: activePreset.mode,
              filePaths: activePreset.filePaths,
              content: compiledPresetContent,
            }
          : null,
        effectiveSelectionId: selection.effectiveSelectionId,
      }),
    )
    .digest('hex')
    .slice(0, 12);

  const summary: SystemPromptSurfaceSummary = {
    sourceKind: selection.sourceKind,
    builtinModified,
    ...(activePreset
      ? {
          presetId: activePreset.id,
          presetName: activePreset.name,
          presetMode: activePreset.mode,
        }
      : {}),
    ...(selection.missingPresetId ? { missingPresetId: selection.missingPresetId } : {}),
    ...(missingFilePaths.length > 0 ? { missingFilePaths } : {}),
  };

  return {
    baseAgentPrompt: isReplace
      ? undefined
      : agentDefault.effectiveContent.length > 0
        ? agentDefault.effectiveContent
        : undefined,
    baseConversationPrompt: isReplace
      ? undefined
      : conversationChat.effectiveContent.length > 0
        ? conversationChat.effectiveContent
        : undefined,
    ...(artifactDecision.isCustomized
      ? { artifactDecisionPrompt: artifactDecision.effectiveContent }
      : {}),
    ...(isAppend ? { presetAppendPrompt: compiledPresetContent } : {}),
    ...(isReplace ? { systemPromptOverride: compiledPresetContent } : {}),
    summary,
    revisionSeed,
  };
}
