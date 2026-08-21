import type { ModelRef, ThinkingLevel } from '@piwin/contracts';

export type ComposerModelPickerOption = {
  providerId: string;
  modelId: string;
  protocol?: ModelRef['protocol'];
  thinkingLevel?: ThinkingLevel;
};

export function formatComposerModelKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

export function findComposerModelByKey(
  options: readonly ComposerModelPickerOption[],
  key: string,
): ComposerModelPickerOption | undefined {
  if (!key) {
    return undefined;
  }
  return options.find(
    (model) => formatComposerModelKey(model.providerId, model.modelId) === key,
  );
}

export function findComposerModelByRef(
  options: readonly ComposerModelPickerOption[],
  ref: Pick<ModelRef, 'providerId' | 'modelId' | 'protocol'>,
): ComposerModelPickerOption | undefined {
  return options.find(
    (model) =>
      model.providerId === ref.providerId &&
      model.modelId === ref.modelId &&
      model.protocol === ref.protocol,
  );
}

function isSelectedModelKeyValid(
  selectedModelKey: string,
  modelOptions: readonly ComposerModelPickerOption[],
): boolean {
  return findComposerModelByKey(modelOptions, selectedModelKey) !== undefined;
}

/**
 * Whether the composer model picker should keep the current selection instead
 * of re-applying session defaults / composerProfile on catalog or config refresh.
 */
export function shouldPreserveComposerModelPicker(args: {
  sessionChanged: boolean;
  activeSessionId: string | null;
  selectedModelKey: string;
  modelOptions: readonly ComposerModelPickerOption[];
}): boolean {
  if (args.sessionChanged) {
    return false;
  }
  if (isSelectedModelKeyValid(args.selectedModelKey, args.modelOptions)) {
    return true;
  }
  return args.activeSessionId !== null && args.selectedModelKey.length === 0;
}

/** Host bootstrap may arrive after the user already picked a model in draft. */
export function resolveBootstrapSelectedModelKey(
  currentKey: string,
  defaultProviderId: string | undefined,
  defaultModelId: string | undefined,
): string {
  if (currentKey.length > 0) {
    return currentKey;
  }
  if (defaultProviderId && defaultModelId) {
    return formatComposerModelKey(defaultProviderId, defaultModelId);
  }
  return currentKey;
}

export type ComposerModelResolutionInput = {
  sessionChanged: boolean;
  activeSessionId: string | null;
  selectedModelKey: string;
  modelOptions: readonly ComposerModelPickerOption[];
  activeSessionModel?: Pick<ModelRef, 'providerId' | 'modelId' | 'protocol'> | null;
  activeSessionThinkingLevel?: ThinkingLevel;
  composerProfileModel?: Pick<ModelRef, 'providerId' | 'modelId' | 'protocol'> | null;
  composerProfileThinkingLevel?: ThinkingLevel;
  defaultProviderId?: string;
  defaultModelId?: string;
};

export type ComposerModelResolution =
  | { kind: 'preserve' }
  | {
      kind: 'apply';
      modelKey: string;
      thinkingLevel: ThinkingLevel | undefined;
      markSessionId: string | null;
    };

/**
 * Single resolver for the composer model effect and resume hooks.
 * Priority: session last-used model → preserve in-flight pick → composerProfile → default.
 */
export function resolveComposerModelSelection(
  input: ComposerModelResolutionInput,
): ComposerModelResolution {
  if (input.sessionChanged && input.activeSessionModel) {
    const sessionModel = findComposerModelByRef(input.modelOptions, input.activeSessionModel);
    if (sessionModel) {
      return {
        kind: 'apply',
        modelKey: formatComposerModelKey(sessionModel.providerId, sessionModel.modelId),
        thinkingLevel: input.activeSessionThinkingLevel,
        markSessionId: input.activeSessionId,
      };
    }
  }

  if (
    shouldPreserveComposerModelPicker({
      sessionChanged: input.sessionChanged,
      activeSessionId: input.activeSessionId,
      selectedModelKey: input.selectedModelKey,
      modelOptions: input.modelOptions,
    })
  ) {
    return { kind: 'preserve' };
  }

  const desired = input.composerProfileModel
    ? findComposerModelByRef(input.modelOptions, input.composerProfileModel)
    : undefined;
  const fallback =
    input.defaultProviderId && input.defaultModelId
      ? findComposerModelByKey(
          input.modelOptions,
          formatComposerModelKey(input.defaultProviderId, input.defaultModelId),
        )
      : undefined;
  const resolved = desired ?? fallback;

  return {
    kind: 'apply',
    modelKey: resolved ? formatComposerModelKey(resolved.providerId, resolved.modelId) : '',
    thinkingLevel: input.composerProfileThinkingLevel ?? resolved?.thinkingLevel,
    markSessionId: input.activeSessionId,
  };
}
