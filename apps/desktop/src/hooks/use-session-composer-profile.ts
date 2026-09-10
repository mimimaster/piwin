/**
 * Per-session composer model/thinking for side chat and supplementary
 * conversation panes. Catalog comes
 * from secret-free `models/configured`; selection is restored from resume and
 * written back with `session/set-composer-profile`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  readConfiguredChatModelsData,
  toModelRef,
  type ModelRef,
  type ThinkingLevel,
} from '@piwin/contracts';
import {
  formatComposerModelKey,
  resolveComposerModelSelection,
} from '../composer-model-selection-policy.js';
import type { HostClient } from '../host-client.js';
import { canUseThinkingLevel, resolveThinkingLevelForModel } from '../model-thinking-policy.js';
import { modelOptionsFromConfiguredModels, type ModelOption } from '../model-options.js';
import { commitSessionComposerProfile } from './commit-session-composer-profile.js';

export type SessionComposerPromptFields = {
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};

export function sessionComposerPromptFields(args: {
  modelOptions: readonly ModelOption[];
  selectedModelKey: string;
  thinkingLevel: ThinkingLevel;
}): SessionComposerPromptFields {
  const selected = findSessionComposerModel(args.modelOptions, args.selectedModelKey);
  const fields: SessionComposerPromptFields = {};
  if (selected) {
    fields.model = toModelRef({
      providerId: selected.providerId,
      modelId: selected.modelId,
      ...(selected.protocol !== undefined ? { protocol: selected.protocol } : {}),
      ...(selected.source !== undefined ? { source: selected.source } : {}),
    });
    if (canUseThinkingLevel(selected, args.thinkingLevel, true)) {
      fields.thinkingLevel = args.thinkingLevel;
    }
  }
  return fields;
}

export type UseSessionComposerProfileArgs = {
  hostClient: HostClient;
  sessionId: string | null;
  resumeModel?: ModelRef | null;
  resumeThinkingLevel?: ThinkingLevel;
};

export type SessionComposerProfileState = {
  modelOptions: ModelOption[];
  selectedModelKey: string;
  selectedModelLabel: string;
  thinkingLevel: ThinkingLevel;
  promptFields: SessionComposerPromptFields;
  selectModel: (modelKey: string) => Promise<void>;
  setThinkingLevel: (level: ThinkingLevel) => Promise<void>;
};

function modelKeyOf(model: ModelRef | null | undefined): string {
  if (!model) return '';
  return formatComposerModelKey(model.providerId, model.modelId);
}

function findSessionComposerModel(
  modelOptions: readonly ModelOption[],
  key: string,
): ModelOption | undefined {
  if (!key) return undefined;
  return modelOptions.find(
    (model) => formatComposerModelKey(model.providerId, model.modelId) === key,
  );
}

export function useSessionComposerProfile(
  args: UseSessionComposerProfileArgs,
): SessionComposerProfileState {
  const { hostClient, sessionId } = args;
  const resumeModel = args.resumeModel ?? null;
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string | undefined>(undefined);
  const [defaultModelId, setDefaultModelId] = useState<string | undefined>(undefined);
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [thinkingLevel, setThinkingLevelState] = useState<ThinkingLevel>('off');
  const lastAppliedSessionIdRef = useRef<string | null>(null);
  const lastAppliedResumeKeyRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await hostClient.request({ type: 'models/configured' });
        if (cancelled || !response.success) return;
        const catalog = readConfiguredChatModelsData(response.data);
        setModelOptions(modelOptionsFromConfiguredModels(catalog.models));
        setDefaultProviderId(catalog.defaultProviderId);
        setDefaultModelId(catalog.defaultModelId);
      } catch {
        // Catalog is best-effort: the picker stays empty until Host answers.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostClient]);

  useEffect(() => {
    const resumeKey = modelKeyOf(resumeModel);
    const sessionChanged =
      lastAppliedSessionIdRef.current !== sessionId ||
      lastAppliedResumeKeyRef.current !== resumeKey ||
      selectedModelKey.length === 0;
    const resolution = resolveComposerModelSelection({
      sessionChanged,
      activeSessionId: sessionId,
      selectedModelKey,
      modelOptions,
      ...(resumeModel ? { activeSessionModel: resumeModel } : {}),
      ...(args.resumeThinkingLevel !== undefined
        ? { activeSessionThinkingLevel: args.resumeThinkingLevel }
        : {}),
      ...(defaultProviderId ? { defaultProviderId } : {}),
      ...(defaultModelId ? { defaultModelId } : {}),
    });
    lastAppliedSessionIdRef.current = sessionId;
    lastAppliedResumeKeyRef.current = resumeKey;
    if (resolution.kind === 'preserve') return;
    setSelectedModelKey(resolution.modelKey);
    if (resolution.thinkingLevel !== undefined) {
      setThinkingLevelState(resolution.thinkingLevel);
    }
    // selectedModelKey is read to preserve an in-flight pick; user changes own it.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [
    args.resumeThinkingLevel,
    defaultModelId,
    defaultProviderId,
    modelOptions,
    resumeModel,
    sessionId,
  ]);

  const persistProfile = useCallback(
    async (nextModelKey: string, nextThinkingLevel: ThinkingLevel): Promise<void> => {
      const selected = findSessionComposerModel(modelOptions, nextModelKey);
      if (!selected) return;
      await commitSessionComposerProfile({
        request: (command) => hostClient.request(command),
        sessionId,
        model: toModelRef({
          providerId: selected.providerId,
          modelId: selected.modelId,
          ...(selected.protocol !== undefined ? { protocol: selected.protocol } : {}),
          ...(selected.source !== undefined ? { source: selected.source } : {}),
        }),
        thinkingLevel: nextThinkingLevel,
      });
    },
    [hostClient, modelOptions, sessionId],
  );

  const selectModel = useCallback(
    async (modelKey: string): Promise<void> => {
      const selected = findSessionComposerModel(modelOptions, modelKey);
      if (!selected || modelKey === selectedModelKey) return;
      const nextThinking =
        resolveThinkingLevelForModel(selected, thinkingLevel, false) ?? 'off';
      setSelectedModelKey(modelKey);
      setThinkingLevelState(nextThinking);
      await persistProfile(modelKey, nextThinking);
    },
    [modelOptions, persistProfile, selectedModelKey, thinkingLevel],
  );

  const setThinkingLevel = useCallback(
    async (level: ThinkingLevel): Promise<void> => {
      if (level === thinkingLevel) return;
      setThinkingLevelState(level);
      await persistProfile(selectedModelKey, level);
    },
    [persistProfile, selectedModelKey, thinkingLevel],
  );

  const selectedModelLabel = useMemo(() => {
    const selected = findSessionComposerModel(modelOptions, selectedModelKey);
    return selected?.label ?? 'Default model';
  }, [modelOptions, selectedModelKey]);

  const promptFields = useMemo(
    () =>
      sessionComposerPromptFields({
        modelOptions,
        selectedModelKey,
        thinkingLevel,
      }),
    [modelOptions, selectedModelKey, thinkingLevel],
  );

  return {
    modelOptions,
    selectedModelKey,
    selectedModelLabel,
    thinkingLevel,
    promptFields,
    selectModel,
    setThinkingLevel,
  };
}
