/**
 * Inline model edit form — slides down within the parent view instead of
 * popping out. Compact two-column layout with a chip-based thinking effort
 * selector and inline capability checkboxes.
 */
import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import {
  THINKING_LEVEL_OPTIONS,
  type ModelCatalogEntry,
  type ModelConfigEntry,
  type ModelProviderConfig,
  type ThinkingLevel,
} from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import { getDesktopTranslator } from './desktop-locale.js';
import {
  withImageGenerationEnabled,
  withVideoGenerationEnabled,
} from './generation-route-defaults.js';
import { ModelGenerationRouteFields } from './model-generation-route-fields.js';
import {
  createModelConfigurationDraft,
  validateModelConfigurationDraft,
  type ModelConfigurationDraft,
} from './model-configuration.js';

export type ModelEditInlineProps = {
  model: ModelConfigEntry;
  providerProtocol: ModelProviderConfig['protocol'];
  disabled: boolean;
  isChinese: boolean;
  searchCatalog?: (query: string) => Promise<ModelCatalogEntry[]>;
  onSave: (draft: ModelConfigurationDraft) => void;
  onCancel: () => void;
};

export function ModelEditInline(props: ModelEditInlineProps): ReactElement {
  const { model, searchCatalog, onSave, onCancel, isChinese, disabled } = props;
  const [localDraft, setLocalDraft] = useState<ModelConfigurationDraft>(() =>
    createModelConfigurationDraft(model, undefined, props.providerProtocol),
  );
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const dirtyRef = useRef(false);
  const savedFlashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!dirtyRef.current) {
      setLocalDraft(createModelConfigurationDraft(model, undefined, props.providerProtocol));
      setError(null);
    }
    if (!searchCatalog) return;
    const search = searchCatalog;
    let cancelled = false;
    async function hydrate(): Promise<void> {
      try {
        const results = await search(model.id);
        if (cancelled) return;
        if (!dirtyRef.current) {
          const exact = results.find(
            (entry) => entry.modelId.toLowerCase() === model.id.toLowerCase(),
          );
          if (exact) {
            setLocalDraft(createModelConfigurationDraft(model, exact, props.providerProtocol));
          }
        }
      } catch (err) {
        console.warn('[ModelEditInline] catalog defaults unavailable', err);
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [model, searchCatalog, props.providerProtocol]);

  useEffect(() => {
    return () => {
      if (savedFlashTimerRef.current !== null) {
        window.clearTimeout(savedFlashTimerRef.current);
      }
    };
  }, []);

  function updateDraft(
    update: (current: ModelConfigurationDraft) => ModelConfigurationDraft,
  ): void {
    dirtyRef.current = true;
    setLocalDraft((current) => update(current));
  }

  function handleThinkingToggle(level: ThinkingLevel, checked: boolean): void {
    updateDraft((current) => {
      const nextLevels = checked
        ? THINKING_LEVEL_OPTIONS.filter((l) => l === level || current.thinkingLevels.includes(l))
        : current.thinkingLevels.filter((l) => l !== level);
      const nextLevel =
        current.thinkingLevel && nextLevels.includes(current.thinkingLevel)
          ? current.thinkingLevel
          : (nextLevels[0] ?? '');
      return { ...current, thinkingLevels: nextLevels, thinkingLevel: nextLevel };
    });
  }

  function flashSaved(): void {
    setSavedFlash(true);
    if (savedFlashTimerRef.current !== null) {
      window.clearTimeout(savedFlashTimerRef.current);
    }
    savedFlashTimerRef.current = window.setTimeout(() => {
      setSavedFlash(false);
      savedFlashTimerRef.current = null;
    }, 1500);
  }

  function submitSave(): void {
    const draftToSave = normalizeDraftForSave(localDraft);
    const validation = validateModelConfigurationDraft(draftToSave);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    dirtyRef.current = false;
    onSave(draftToSave);
    flashSaved();
  }

  const providerCopy = getDesktopTranslator(isChinese ? 'zh-CN' : 'en').settings.provider;
  const t = isChinese
    ? {
        label: '显示名称',
        context: '上下文',
        output: '最大输出',
        tooltip: '描述',
        thinking: '思考强度',
        thinkingDefault: '默认',
        thinkingHint: '点击切换支持的级别',
        vision: '视觉',
        reasoning: '推理',
        imageGen: '生图',
        videoGen: '视频',
        realtime: '实时语音',
        nativeSearch: providerCopy.nativeSearch,
        cancel: '取消',
        save: '保存',
        saved: '已保存',
      }
    : {
        label: 'Label',
        context: 'Context',
        output: 'Max output',
        tooltip: 'Tooltip',
        thinking: 'Thinking effort',
        thinkingDefault: 'Default',
        thinkingHint: 'Click to toggle supported levels',
        vision: 'Vision',
        reasoning: 'Reasoning',
        imageGen: 'Image gen',
        videoGen: 'Video',
        realtime: 'Realtime',
        nativeSearch: providerCopy.nativeSearch,
        cancel: 'Cancel',
        save: 'Save',
        saved: 'Saved',
      };

  return (
    <div className="model-edit-inline" data-testid="model-edit-inline">
      {error ? (
        <p className="ui-field-error" role="alert" data-testid="model-edit-error">
          {error}
        </p>
      ) : null}

      <div className="model-edit-inline-row">
        <label className="model-edit-inline-field">
          <span className="model-edit-inline-label">{t.label}</span>
          <input
            type="text"
            value={localDraft.label}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) => ({ ...current, label: event.target.value }))
            }
            data-testid="model-edit-label"
            disabled={disabled}
          />
        </label>
        <label className="model-edit-inline-field">
          <span className="model-edit-inline-label">{t.context}</span>
          <input
            type="text"
            value={localDraft.contextWindow}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) => ({
                ...current,
                contextWindow: event.target.value,
              }))
            }
            data-testid="model-edit-context"
            disabled={disabled}
          />
        </label>
      </div>

      <div className="model-edit-inline-row">
        <label className="model-edit-inline-field">
          <span className="model-edit-inline-label">{t.output}</span>
          <input
            type="text"
            value={localDraft.maxOutputTokens}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) => ({
                ...current,
                maxOutputTokens: event.target.value,
              }))
            }
            data-testid="model-edit-output"
            disabled={disabled}
          />
        </label>
        <label className="model-edit-inline-field">
          <span className="model-edit-inline-label">{t.tooltip}</span>
          <input
            type="text"
            value={localDraft.tooltipMarkdown}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) => ({
                ...current,
                tooltipMarkdown: event.target.value,
              }))
            }
            data-testid="model-edit-tooltip"
            disabled={disabled}
          />
        </label>
      </div>

      <div className="model-edit-inline-caps">
        <label className="model-edit-inline-cap">
          <input
            type="checkbox"
            checked={localDraft.supportsImage}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) => ({ ...current, supportsImage: event.target.checked }))
            }
            data-testid="model-edit-supports-image"
            disabled={disabled}
          />
          <span>{t.vision}</span>
        </label>
        <label className="model-edit-inline-cap">
          <input
            type="checkbox"
            checked={localDraft.reasoning}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) =>
                event.target.checked
                  ? { ...current, reasoning: true }
                  : { ...current, reasoning: false, thinkingLevel: '', thinkingLevels: [] },
              )
            }
            data-testid="model-edit-reasoning"
            disabled={disabled}
          />
          <span>{t.reasoning}</span>
        </label>
        <label className="model-edit-inline-cap">
          <input
            type="checkbox"
            checked={localDraft.supportsImageGeneration}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) =>
                withImageGenerationEnabled(
                  current,
                  event.target.checked,
                  props.providerProtocol,
                ),
              )
            }
            data-testid="model-edit-image-generation"
            disabled={disabled}
          />
          <span>{t.imageGen}</span>
        </label>
        <label className="model-edit-inline-cap">
          <input
            type="checkbox"
            checked={localDraft.supportsVideoGeneration}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) =>
                withVideoGenerationEnabled(
                  current,
                  event.target.checked,
                  props.providerProtocol,
                ),
              )
            }
            data-testid="model-edit-video-generation"
            disabled={disabled}
          />
          <span>{t.videoGen}</span>
        </label>
        <label className="model-edit-inline-cap">
          <input
            type="checkbox"
            checked={localDraft.supportsRealtimeAudio}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) => ({
                ...current,
                supportsRealtimeAudio: event.target.checked,
              }))
            }
            data-testid="model-edit-realtime-audio"
            disabled={disabled}
          />
          <span>{t.realtime}</span>
        </label>
        <label className="model-edit-inline-cap">
          <input
            type="checkbox"
            checked={localDraft.supportsNativeWebSearch}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) => ({
                ...current,
                supportsNativeWebSearch: event.target.checked,
              }))
            }
            data-testid="model-edit-native-web-search"
            disabled={disabled}
          />
          <span>{t.nativeSearch}</span>
        </label>
      </div>

      <ModelGenerationRouteFields
        draft={localDraft}
        disabled={disabled}
        isChinese={isChinese}
        onChange={updateDraft}
      />

      {localDraft.reasoning ? (
        <div className="model-edit-inline-thinking">
          <div className="model-edit-inline-thinking-head">
            <span className="model-edit-inline-label">
              {t.thinking}
              <span className="model-edit-inline-thinking-hint">{t.thinkingHint}</span>
            </span>
            <label className="model-edit-inline-default">
              <span>{t.thinkingDefault}</span>
              <select
                value={localDraft.thinkingLevel}
                disabled={localDraft.thinkingLevels.length === 0}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  updateDraft((current) => ({
                    ...current,
                    thinkingLevel: event.target.value as ThinkingLevel | '',
                  }))
                }
                data-testid="model-edit-thinking-default"
              >
                <option value="">—</option>
                {localDraft.thinkingLevels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="model-edit-inline-chips" data-testid="model-edit-thinking-chips">
            {THINKING_LEVEL_OPTIONS.map((level) => {
              const active = localDraft.thinkingLevels.includes(level);
              return (
                <button
                  key={level}
                  type="button"
                  className={active ? 'model-edit-chip is-active' : 'model-edit-chip'}
                  onClick={() => handleThinkingToggle(level, !active)}
                  data-testid={`model-edit-thinking-level-${level}`}
                  disabled={disabled}
                >
                  {level}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="model-edit-inline-footer">
        {savedFlash ? (
          <span className="model-edit-inline-saved" data-testid="model-edit-saved-hint">
            {t.saved}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="compact"
          onClick={onCancel}
          data-testid="model-edit-cancel"
          disabled={disabled}
        >
          {t.cancel}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="compact"
          onClick={submitSave}
          data-testid="model-edit-save"
          disabled={disabled}
        >
          {t.save}
        </Button>
      </div>
    </div>
  );
}

/** Reasoning-off models must not carry thinking levels. */
function normalizeDraftForSave(draft: ModelConfigurationDraft): ModelConfigurationDraft {
  return draft.reasoning ? draft : { ...draft, thinkingLevel: '', thinkingLevels: [] };
}
