/**
 * Composer model picker: persist last-used model/thinking, compact when the
 * next model cannot hold the occupied context, and restore from session resume.
 * State (selectedModelKey / thinkingLevel) stays in App because Host bootstrap
 * and session actions both need the setters before this controller can run.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  formatError,
  readContextOccupiedTokens,
  resolveModelContextBudget,
  type ContextUsageSnapshot,
  toModelRef,
  type ModelRef,
  type PiwinConfig,
  type ThinkingLevel,
} from '@piwin/contracts';
import { composerProfileSettingsMutations } from '../host-request-adapters';
import {
  findComposerModelByKey,
  findComposerModelByRef,
  formatComposerModelKey,
  resolveComposerModelSelection,
} from '../composer-model-selection-policy';
import type { HostClient } from '../host-client';
import type { ChatUiAction, SessionListItemUi } from '../chat-reducer';
import { pushError, type NotificationAction } from '../notification-queue';
import { resolveThinkingLevelForModel } from '../model-thinking-policy';
import type { ModelOption } from '../model-options';

export type ComposerModelRestoreProfile = {
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};

export type UseComposerModelControllerArgs = {
  hostClient: HostClient;
  config: PiwinConfig | null;
  setConfig: Dispatch<SetStateAction<PiwinConfig | null>>;
  modelOptions: ModelOption[];
  defaultProviderId: string | undefined;
  defaultModelId: string | undefined;
  selectedModelKey: string;
  setSelectedModelKey: Dispatch<SetStateAction<string>>;
  thinkingLevel: ThinkingLevel;
  setThinkingLevel: Dispatch<SetStateAction<ThinkingLevel>>;
  sessions: readonly SessionListItemUi[];
  generalSessions: readonly SessionListItemUi[];
  activeSessionId: string | null;
  contextUsage: ContextUsageSnapshot | null;
  streaming: boolean;
  compacting: boolean;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification: Dispatch<NotificationAction>;
  saveSettingsInOrder: import('./use-settings-save-queue').SaveSettingsInOrder;
  sessionComposerProfileRestoredRef: MutableRefObject<
    (profile: ComposerModelRestoreProfile) => void
  >;
};

export function describeComposerModel(
  modelOptions: readonly ModelOption[],
  selectedModelKey: string,
  defaults: { providerId?: string; modelId?: string },
): {
  label: string;
  contextWindow: number | undefined;
  promptModel: ModelRef | null;
} {
  const selected = selectedModelKey
    ? modelOptions.find(
        (option) => formatComposerModelKey(option.providerId, option.modelId) === selectedModelKey,
      )
    : undefined;
  const fallback =
    selected ??
    modelOptions.find(
      (option) =>
        option.providerId === defaults.providerId && option.modelId === defaults.modelId,
    );
  const promptModel: ModelRef | null = fallback
    ? toModelRef({
        providerId: fallback.providerId,
        modelId: fallback.modelId,
        ...(fallback.protocol !== undefined ? { protocol: fallback.protocol } : {}),
        ...(fallback.source !== undefined ? { source: fallback.source } : {}),
      })
    : null;
  return {
    label: selected?.label ?? 'Default model',
    contextWindow: fallback?.contextWindow,
    promptModel,
  };
}

export function useComposerModelController(args: UseComposerModelControllerArgs) {
  const {
    hostClient,
    config,
    setConfig,
    modelOptions,
    defaultProviderId,
    defaultModelId,
    selectedModelKey,
    setSelectedModelKey,
    thinkingLevel,
    setThinkingLevel,
    sessions,
    generalSessions,
    activeSessionId,
    contextUsage,
    streaming,
    compacting,
    dispatch,
    dispatchNotification,
    saveSettingsInOrder,
    sessionComposerProfileRestoredRef,
  } = args;

  const modelSwitchInFlightRef = useRef(false);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  const lastAppliedSessionModelIdRef = useRef<string | null>(null);

  const applyComposerModelSelection = useCallback(
    (modelKey: string, requestedThinking: ThinkingLevel | undefined): void => {
      const selected = findComposerModelByKey(modelOptions, modelKey);
      const resolvedKey = selected
        ? formatComposerModelKey(selected.providerId, selected.modelId)
        : modelKey;
      setSelectedModelKey(resolvedKey);
      const resolvedThinking = resolveThinkingLevelForModel(
        selected,
        requestedThinking ?? selected?.thinkingLevel ?? 'off',
        config?.thinking?.ultraEnabled === true,
      );
      setThinkingLevel(resolvedThinking ?? 'off');
    },
    [config?.thinking?.ultraEnabled, modelOptions, setSelectedModelKey, setThinkingLevel],
  );

  // Keep the in-memory thinking level legal for the selected model. Do not
  // persist: the control used to call onChange on every catalog/config refresh,
  // which replaced `desktop` and CAS-conflicted with lastSession persist.
  useEffect(() => {
    const selected = findComposerModelByKey(modelOptions, selectedModelKey);
    const resolved = resolveThinkingLevelForModel(
      selected,
      thinkingLevel,
      config?.thinking?.ultraEnabled === true,
    );
    if (resolved !== undefined && resolved !== thinkingLevel) {
      setThinkingLevel(resolved);
    }
  }, [
    config?.thinking?.ultraEnabled,
    modelOptions,
    selectedModelKey,
    setThinkingLevel,
    thinkingLevel,
  ]);

  // Resolve the effective model selection. Priority:
  //   1. active session last-used model (session index / resume)
  //   2. composerProfile.model (desktop default for new sessions)
  //   3. config.defaultProviderId / defaultModelId (product default)
  useEffect(() => {
    const sessionChanged = lastAppliedSessionModelIdRef.current !== activeSessionId;
    const activeSession =
      activeSessionId == null
        ? undefined
        : (sessions.find((session) => session.id === activeSessionId) ??
          generalSessions.find((session) => session.id === activeSessionId));
    const composerProfile = config?.desktop?.composerProfile;
    const resolution = resolveComposerModelSelection({
      sessionChanged,
      activeSessionId,
      selectedModelKey,
      modelOptions,
      ...(activeSession?.model ? { activeSessionModel: activeSession.model } : {}),
      ...(activeSession?.thinkingLevel !== undefined
        ? { activeSessionThinkingLevel: activeSession.thinkingLevel }
        : {}),
      ...(composerProfile?.model ? { composerProfileModel: composerProfile.model } : {}),
      ...(composerProfile?.thinkingLevel !== undefined
        ? { composerProfileThinkingLevel: composerProfile.thinkingLevel }
        : {}),
      ...(defaultProviderId ? { defaultProviderId } : {}),
      ...(defaultModelId ? { defaultModelId } : {}),
    });
    if (resolution.kind === 'preserve') {
      return;
    }
    lastAppliedSessionModelIdRef.current = resolution.markSessionId;
    applyComposerModelSelection(resolution.modelKey, resolution.thinkingLevel);
    // User picker updates (`handleSelectModel`) own selectedModelKey; this
    // effect only reacts to session/config/catalog changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedModelKey read intentionally omitted
  }, [
    applyComposerModelSelection,
    config?.desktop?.composerProfile,
    defaultProviderId,
    defaultModelId,
    generalSessions,
    modelOptions,
    activeSessionId,
    sessions,
  ]);

  // Resume payload may carry model before the session list row is updated.
  useEffect(() => {
    sessionComposerProfileRestoredRef.current = (profile) => {
      if (profile.model) {
        const match = findComposerModelByRef(modelOptions, profile.model);
        if (match) {
          lastAppliedSessionModelIdRef.current = activeSessionId;
          applyComposerModelSelection(
            formatComposerModelKey(match.providerId, match.modelId),
            profile.thinkingLevel,
          );
          return;
        }
      }
      if (profile.thinkingLevel) {
        const selected = findComposerModelByKey(modelOptions, selectedModelKey);
        const resolvedThinking = resolveThinkingLevelForModel(
          selected,
          profile.thinkingLevel,
          config?.thinking?.ultraEnabled === true,
        );
        setThinkingLevel(resolvedThinking ?? profile.thinkingLevel);
      }
    };
  }, [
    activeSessionId,
    applyComposerModelSelection,
    config?.thinking?.ultraEnabled,
    modelOptions,
    selectedModelKey,
    sessionComposerProfileRestoredRef,
    setThinkingLevel,
  ]);

  const persistComposerProfile = useCallback(
    (nextModelKey: string, nextThinkingLevel: ThinkingLevel): void => {
      if (!config) {
        return;
      }
      const selectedModel = modelOptions.find(
        (model) => formatComposerModelKey(model.providerId, model.modelId) === nextModelKey,
      );
      const nextConfig: PiwinConfig = {
        ...config,
        ...(selectedModel
          ? {
              defaultProviderId: selectedModel.providerId,
              defaultModelId: selectedModel.modelId,
            }
          : {}),
        thinking: {
          ultraEnabled: config.thinking?.ultraEnabled === true,
          defaultLevel: nextThinkingLevel,
        },
        desktop: {
          ...config.desktop,
          composerProfile: {
            ...(selectedModel
              ? {
                  model: toModelRef({
                    providerId: selectedModel.providerId,
                    modelId: selectedModel.modelId,
                    source: selectedModel.source ?? 'channel',
                    ...(selectedModel.protocol !== undefined
                      ? { protocol: selectedModel.protocol }
                      : {}),
                  }),
                }
              : {}),
            thinkingLevel: nextThinkingLevel,
          },
        },
      };
      if (
        JSON.stringify(config.desktop?.composerProfile ?? null) ===
        JSON.stringify(nextConfig.desktop?.composerProfile ?? null)
      ) {
        setConfig(nextConfig);
        return;
      }
      setConfig(nextConfig);
      void saveSettingsInOrder((currentConfig) =>
        composerProfileSettingsMutations({
          transport: hostClient.getTransport(),
          currentDesktop: currentConfig.desktop,
          composerProfile: nextConfig.desktop?.composerProfile,
          currentThinking: currentConfig.thinking,
          selectedModel: selectedModel
            ? { providerId: selectedModel.providerId, modelId: selectedModel.modelId }
            : undefined,
        }),
      );
    },
    [config, hostClient, modelOptions, saveSettingsInOrder, setConfig],
  );

  const handleSelectModel = useCallback(
    async (nextModelKey: string): Promise<void> => {
      const nextModel = modelOptions.find(
        (model) => formatComposerModelKey(model.providerId, model.modelId) === nextModelKey,
      );
      if (!nextModel || nextModelKey === selectedModelKey || modelSwitchInFlightRef.current) {
        return;
      }
      const occupiedTokens = readContextOccupiedTokens(contextUsage);
      const targetBudget = resolveModelContextBudget({
        ...(nextModel.contextWindow !== undefined
          ? { contextWindow: nextModel.contextWindow }
          : {}),
        ...(nextModel.maxOutputTokens !== undefined
          ? { maxOutputTokens: nextModel.maxOutputTokens }
          : {}),
      });
      if (
        activeSessionId &&
        occupiedTokens !== undefined &&
        occupiedTokens > targetBudget.inputBudget
      ) {
        if (streaming || compacting) {
          dispatch({
            type: 'error',
            message: 'Wait for the current operation to finish before switching models.',
          });
          return;
        }
        modelSwitchInFlightRef.current = true;
        const preparedSessionId = activeSessionId;
        try {
          const response = await hostClient.request({
            type: 'session/compact',
            sessionId: preparedSessionId,
            targetModel: toModelRef({
              providerId: nextModel.providerId,
              modelId: nextModel.modelId,
              ...(nextModel.protocol !== undefined ? { protocol: nextModel.protocol } : {}),
              ...(nextModel.source !== undefined ? { source: nextModel.source } : {}),
            }),
          });
          if (!response.success) {
            dispatchNotification(pushError(response.error));
            return;
          }
          if (activeSessionIdRef.current !== preparedSessionId) {
            return;
          }
        } catch (error) {
          dispatchNotification(pushError(formatError(error)));
          return;
        } finally {
          modelSwitchInFlightRef.current = false;
        }
      }
      const nextThinkingLevel =
        resolveThinkingLevelForModel(
          nextModel,
          thinkingLevel,
          config?.thinking?.ultraEnabled === true,
        ) ?? 'off';
      setSelectedModelKey(nextModelKey);
      setThinkingLevel(nextThinkingLevel);
      persistComposerProfile(nextModelKey, nextThinkingLevel);
    },
    [
      activeSessionId,
      compacting,
      config?.thinking?.ultraEnabled,
      contextUsage,
      dispatch,
      dispatchNotification,
      hostClient,
      modelOptions,
      persistComposerProfile,
      selectedModelKey,
      setSelectedModelKey,
      setThinkingLevel,
      streaming,
      thinkingLevel,
    ],
  );

  const handleThinkingLevelChange = useCallback(
    (nextThinkingLevel: ThinkingLevel): void => {
      if (nextThinkingLevel === thinkingLevel) {
        return;
      }
      setThinkingLevel(nextThinkingLevel);
      persistComposerProfile(selectedModelKey, nextThinkingLevel);
    },
    [persistComposerProfile, selectedModelKey, setThinkingLevel, thinkingLevel],
  );

  const described = useMemo(
    () =>
      describeComposerModel(modelOptions, selectedModelKey, {
        ...(defaultProviderId !== undefined ? { providerId: defaultProviderId } : {}),
        ...(defaultModelId !== undefined ? { modelId: defaultModelId } : {}),
      }),
    [defaultModelId, defaultProviderId, modelOptions, selectedModelKey],
  );

  return {
    handleSelectModel,
    handleThinkingLevelChange,
    selectedModelLabel: described.label,
    selectedModelContextWindow: described.contextWindow,
    currentPromptModelRef: described.promptModel,
  };
}
