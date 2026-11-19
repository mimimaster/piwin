/**
 * System-prompt compilation and status summary helpers for host-runtime.
 */
import { createHash } from 'node:crypto';
import type {
  CreateSessionInput,
  PiwinConfig,
  ResolvedSessionLocation,
  ResolvedSystemPromptSourceKind,
  SystemPromptMode,
} from '@piwin/contracts';
import {
  formatSystemPromptFileStack,
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

export type CompiledSystemPromptOverlay = {
  baseAgentPrompt: string | undefined;
  baseConversationPrompt: string | undefined;
  presetAppendPrompt?: string;
  systemPromptOverride?: string;
  summary: SystemPromptSurfaceSummary;
  revisionSeed: string;
};

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

  const agentDefault = readBuiltinSystemPromptValue(config, 'agent.default');
  const agentGoal = readBuiltinSystemPromptValue(config, 'agent.goal');
  const conversationChat = readBuiltinSystemPromptValue(config, 'conversation.chat');
  const artifactDecision = readBuiltinSystemPromptValue(config, 'artifact.decision');
  const builtinModified = isConversation
    ? conversationChat.isOverridden || artifactDecision.isOverridden
    : agentDefault.isOverridden || agentGoal.isOverridden || artifactDecision.isOverridden;

  const projectPath =
    location.scope.kind === 'project' ? location.scope.projectPath : undefined;

  const selection = isolated
    ? { sourceKind: 'builtin' as const, effectiveSelectionId: '__builtin__' }
    : resolveActiveSystemPromptSelection({
        config,
        projectPath,
        sessionPresetId: params.sessionPresetId ?? input.systemPromptPresetId,
      });

  const activePreset = selection.preset;
  let compiledPresetContent = '';
  const missingFilePaths: string[] = [];

  if (activePreset && activePreset.filePaths.length > 0) {
    const readResult = await readSystemPromptFiles({
      paths: activePreset.filePaths,
      piwinRoot: params.piwinRoot,
      projectPath,
    });
    const validContents: string[] = [];
    for (const item of readResult.files) {
      if (!item.exists || item.error) {
        missingFilePaths.push(item.path);
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

  const revisionSeed = createHash('sha256')
    .update(
      JSON.stringify({
        isConversation,
        isolated,
        agentDefault: agentDefault.effectiveContent,
        agentGoal: agentGoal.effectiveContent,
        conversationChat: conversationChat.effectiveContent,
        artifactDecision: artifactDecision.effectiveContent,
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
    baseAgentPrompt: isReplace ? undefined : agentDefault.effectiveContent,
    baseConversationPrompt: isReplace ? undefined : conversationChat.effectiveContent,
    ...(isAppend ? { presetAppendPrompt: compiledPresetContent } : {}),
    ...(isReplace ? { systemPromptOverride: compiledPresetContent } : {}),
    summary,
    revisionSeed,
  };
}
