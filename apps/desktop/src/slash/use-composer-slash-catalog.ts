/**
 * Composer slash catalog from dock props: reserved commands, modes, skills and
 * extension commands, with availability derived from the session state.
 */
import { useMemo } from 'react';
import type { ComposerDockProps } from '../composer-dock-types';
import { buildSlashCatalog } from './slash-catalog';
import type { SlashItem } from './slash-types';

export function useComposerSlashCatalog(
  props: ComposerDockProps,
  isStreamingRun: boolean,
): SlashItem[] {
  const isGoalEnabled = props.goalExtensionEnabled !== false;
  return useMemo(
    () =>
      buildSlashCatalog({
        skills: props.menuSkills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          enabled: skill.enabled,
          ...(skill.source ? { source: skill.source } : {}),
        })),
        extensionCommands: props.menuExtensionCommands ?? [],
        compactionSupported: props.compactionSupported !== false,
        streaming: isStreamingRun,
        compacting: props.compacting,
        hasActiveSession: Boolean(props.activeSessionId),
        projectTrusted: props.projectTrusted,
        requireProjectTrust: Boolean(props.projectPath),
        agentMode: props.agentMode,
        goalExtensionEnabled: isGoalEnabled,
        conversationChat: props.isConversationSession === true,
        // ADR 0082: a non-Pi session shows the backend's own commands and
        // drops Pi's product commands/modes, which that backend cannot run.
        backendSession: props.capabilities?.isExternalBackend === true,
        ...(props.backendOptions?.commands !== undefined
          ? { backendCommands: props.backendOptions.commands }
          : {}),
      }),
    [
      props.menuSkills,
      props.menuExtensionCommands,
      props.compactionSupported,
      isStreamingRun,
      props.compacting,
      props.activeSessionId,
      props.projectTrusted,
      props.projectPath,
      props.agentMode,
      isGoalEnabled,
      props.isConversationSession,
      props.capabilities,
      props.backendOptions,
    ],
  );
}
