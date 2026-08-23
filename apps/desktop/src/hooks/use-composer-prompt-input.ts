/**
 * Pure "which fields does this Host prompt request carry" policy: turn model
 * resolution and prompt-input shaping. No I/O, no dispatch — kept separate
 * from send orchestration (`use-composer-send.ts`) so the policy is easy to
 * read and test on its own.
 */
import { useCallback } from 'react';
import type {
  AgentModeId,
  ModelRef,
  PermissionPreset,
  PromptAttachment,
  PromptContextRef,
  ThinkingLevel,
} from '@piwin/contracts';
import { canUseThinkingLevel } from '../model-thinking-policy';
import type { UseComposerMediaArgs } from './composer-media-args.js';

/** Host-shaped `session/prompt` / queued-turn `input`, built from raw composer state. */
export type ComposerPromptRequestInput = {
  text: string;
  attachments?: PromptAttachment[];
  contextRefs?: PromptContextRef[];
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  agentMode?: AgentModeId;
  permissionPreset?: PermissionPreset;
  orchestrationSchemeId?: string;
  clientMessageId?: string;
  skillId?: string;
};

export function isImagePromptAttachment(attachment: PromptAttachment): boolean {
  return (
    attachment.kind === 'media' &&
    (attachment.contentKind === 'image' ||
      (attachment.contentKind === undefined &&
        attachment.mimeType.trim().toLowerCase().startsWith('image/')))
  );
}

export function useComposerPromptInput(args: UseComposerMediaArgs) {
  const resolveTurnModel = useCallback((): ModelRef | undefined => {
    const key = args.selectedModelKey?.trim();
    if (!key || !args.modelOptions?.length) {
      return undefined;
    }
    const option = args.modelOptions.find((item) => `${item.providerId}::${item.modelId}` === key);
    if (!option) {
      return undefined;
    }
    return {
      protocol: option.protocol,
      providerId: option.providerId,
      modelId: option.modelId,
    };
  }, [args.modelOptions, args.selectedModelKey]);

  const buildPromptRequestInput = useCallback(
    (params: {
      text: string;
      attachments?: PromptAttachment[];
      contextRefs?: PromptContextRef[];
      agentMode: AgentModeId;
      clientMessageId?: string;
      skillId?: string;
    }): ComposerPromptRequestInput => {
      const input: ComposerPromptRequestInput = {
        text: params.text,
      };
      if (args.conversationChat !== true) {
        input.agentMode = params.agentMode;
        if (args.permissionPreset) {
          input.permissionPreset = args.permissionPreset;
        }
      }
      if (params.clientMessageId && params.clientMessageId.trim().length > 0) {
        input.clientMessageId = params.clientMessageId.trim();
      }
      if (args.conversationChat !== true && params.skillId && params.skillId.trim().length > 0) {
        input.skillId = params.skillId.trim();
      }
      const schemeId = args.orchestrationSchemeId?.trim();
      if (args.conversationChat !== true && schemeId && schemeId !== 'off') {
        input.orchestrationSchemeId = schemeId;
      }
      if (params.attachments && params.attachments.length > 0) {
        input.attachments = params.attachments;
      }
      // Immutable send snapshot: never re-read live pending refs.
      if (params.contextRefs && params.contextRefs.length > 0) {
        input.contextRefs = params.contextRefs;
      }
      const model = resolveTurnModel();
      if (model) {
        input.model = model;
      }
      const selectedOption = args.modelOptions?.find(
        (option) => `${option.providerId}::${option.modelId}` === args.selectedModelKey,
      );
      if (
        selectedOption &&
        args.thinkingLevel &&
        canUseThinkingLevel(selectedOption, args.thinkingLevel, true)
      ) {
        input.thinkingLevel = args.thinkingLevel;
      }
      return input;
    },
    [
      args.modelOptions,
      args.orchestrationSchemeId,
      args.selectedModelKey,
      args.thinkingLevel,
      args.conversationChat,
      args.permissionPreset,
      resolveTurnModel,
    ],
  );

  return { buildPromptRequestInput };
}
