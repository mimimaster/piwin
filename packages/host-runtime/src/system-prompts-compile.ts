/**
 * Pure system-prompt compilation and status summary helpers for host-runtime.
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
  readBuiltinSystemPromptValue,
  resolveActiveSystemPromptSelection,
} from '@piwin/contracts';
import { getSessionRecord } from '@piwin/session';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';

export type SystemPromptSurfaceSummary = {
  presetId?: string;
  presetName?: string;
  presetMode?: SystemPromptMode;
  sourceKind: ResolvedSystemPromptSourceKind;
  builtinModified: boolean;
  missingPresetId?: string;
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

export function resolveCompiledSystemPromptOverlay(params: {
  config: PiwinConfig;
  input: CreateSessionInput;
  location: ResolvedSessionLocation;
  isConversation: boolean;
  sessionPresetId?: string | undefined;
}): CompiledSystemPromptOverlay {
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
  const isReplace = activePreset?.mode === 'replace';
  const isAppend = activePreset?.mode === 'append';

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
          ? { id: activePreset.id, mode: activePreset.mode, content: activePreset.content }
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
  };

  return {
    baseAgentPrompt: isReplace ? undefined : agentDefault.effectiveContent,
    baseConversationPrompt: isReplace ? undefined : conversationChat.effectiveContent,
    ...(isAppend && activePreset ? { presetAppendPrompt: activePreset.content } : {}),
    ...(isReplace && activePreset ? { systemPromptOverride: activePreset.content } : {}),
    summary,
    revisionSeed,
  };
}
