import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import {
  THINKING_LEVEL_OPTIONS,
  type ModelCatalogEntry,
  type ModelConfigEntry,
  type ModelProviderConfig,
  type ThinkingLevel,
} from '@piwin/contracts';
import { Button, Field, FieldCheckbox, Popover } from '@piwin/ui-kit';
import { IconEdit } from './shell-icons.js';
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

export type ModelEditPopoverProps = {
  model: ModelConfigEntry;
  providerProtocol: ModelProviderConfig['protocol'];
  disabled: boolean;
  isChinese: boolean;
  searchCatalog?: (query: string) => Promise<ModelCatalogEntry[]>;
  onSave: (draft: ModelConfigurationDraft) => void;
};

export function ModelEditPopover(props: ModelEditPopoverProps): ReactElement {
  const { model, searchCatalog, onSave, isChinese, disabled } = props;
  const [open, setOpen] = useState(false);
  const [localDraft, setLocalDraft] = useState<ModelConfigurationDraft>(() =>
    createModelConfigurationDraft(model, undefined, props.providerProtocol),
  );
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const openRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    dirtyRef.current = false;
    setLocalDraft(createModelConfigurationDraft(model, undefined, props.providerProtocol));
    setError(null);
    if (!searchCatalog) return;
    const search = searchCatalog;
    let cancelled = false;
    async function hydrate(): Promise<void> {
      try {
        const results = await search(model.id);
        if (cancelled) return;
        if (!dirtyRef.current && openRef.current) {
          const exact = results.find(
            (entry) => entry.modelId.toLowerCase() === model.id.toLowerCase(),
          );
          if (exact) {
            setLocalDraft(createModelConfigurationDraft(model, exact, props.providerProtocol));
          }
        }
      } catch (error) {
        console.warn('[ModelEditPopover] catalog defaults unavailable', error);
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [open, model, searchCatalog, props.providerProtocol]);

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

  function handleSave(): void {
    const draftToSave: ModelConfigurationDraft = localDraft.reasoning
      ? localDraft
      : { ...localDraft, thinkingLevel: '', thinkingLevels: [] };
    const validation = validateModelConfigurationDraft(draftToSave);
    if (validation) {
      setError(validation);
      return;
    }
    onSave(draftToSave);
    setOpen(false);
  }

  const triggerTitle = isChinese ? '编辑模型' : 'Edit model';
  const labelId = `model-edit-label-${model.id}`;
  const contextId = `model-edit-context-${model.id}`;
  const outputId = `model-edit-output-${model.id}`;
  const tooltipId = `model-edit-tooltip-${model.id}`;
  const thinkingDefaultId = `model-edit-thinking-default-${model.id}`;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      contentClassName="model-edit-popover"
      side="bottom"
      align="end"
      trigger={
        <button
          type="button"
          className="provider-mini-btn"
          title={triggerTitle}
          aria-label={triggerTitle}
          disabled={disabled}
          data-testid={`provider-model-edit-${model.id}`}
        >
          <IconEdit width={12} height={12} />
        </button>
      }
    >
      <div
        className="model-edit-popover-form"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {error ? (
          <p className="ui-field-error" role="alert" data-testid="model-edit-error">
            {error}
          </p>
        ) : null}

        <div className="model-edit-popover-header" data-testid="model-edit-id">
          <strong>{isChinese ? '模型' : 'Model'}</strong>
          <span>{localDraft.id}</span>
        </div>

        <Field
          label={isChinese ? '显示名称' : 'Display label'}
          htmlFor={labelId}
          testId="model-edit-label-field"
        >
          <input
            id={labelId}
            type="text"
            value={localDraft.label}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) => ({ ...current, label: event.target.value }))
            }
            data-testid="model-edit-label"
          />
        </Field>

        <Field
          label={isChinese ? '上下文窗口' : 'Context window'}
          htmlFor={contextId}
          testId="model-edit-context-field"
        >
          <input
            id={contextId}
            type="text"
            value={localDraft.contextWindow}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) => ({
                ...current,
                contextWindow: event.target.value,
              }))
            }
            data-testid="model-edit-context"
          />
        </Field>

        <Field
          label={isChinese ? '最大输出 tokens' : 'Max output tokens'}
          htmlFor={outputId}
          testId="model-edit-output-field"
        >
          <input
            id={outputId}
            type="text"
            value={localDraft.maxOutputTokens}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) => ({
                ...current,
                maxOutputTokens: event.target.value,
              }))
            }
            data-testid="model-edit-output"
          />
        </Field>

        <Field
          label={isChinese ? '描述 / 提示' : 'Tooltip / description'}
          htmlFor={tooltipId}
          testId="model-edit-tooltip-field"
        >
          <input
            id={tooltipId}
            type="text"
            value={localDraft.tooltipMarkdown}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateDraft((current) => ({
                ...current,
                tooltipMarkdown: event.target.value,
              }))
            }
            data-testid="model-edit-tooltip"
          />
        </Field>

        {localDraft.reasoning ? (
          <div className="model-edit-effort-section">
            <Field
              label={isChinese ? '默认思考强度' : 'Default thinking effort'}
              htmlFor={thinkingDefaultId}
              testId="model-edit-thinking-default-field"
            >
              <select
                id={thinkingDefaultId}
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
            </Field>

            <div className="model-edit-effort-options">
              {THINKING_LEVEL_OPTIONS.map((level) => (
                <div key={level} className="model-edit-effort-option">
                  <FieldCheckbox
                    label={level}
                    checked={localDraft.thinkingLevels.includes(level)}
                    onCheckedChange={(checked) => handleThinkingToggle(level, checked)}
                    testId={`model-edit-thinking-level-${level}`}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="model-edit-capability-row">
          <FieldCheckbox
            label={isChinese ? '视觉' : 'Vision'}
            checked={localDraft.supportsImage}
            onCheckedChange={(checked) =>
              updateDraft((current) => ({ ...current, supportsImage: checked }))
            }
            testId="model-edit-supports-image"
          />
          <FieldCheckbox
            label={isChinese ? '推理' : 'Reasoning'}
            checked={localDraft.reasoning}
            onCheckedChange={(checked) =>
              updateDraft((current) =>
                checked
                  ? { ...current, reasoning: true }
                  : { ...current, reasoning: false, thinkingLevel: '', thinkingLevels: [] },
              )
            }
            testId="model-edit-reasoning"
          />
          <FieldCheckbox
            label={isChinese ? '生图' : 'Image generation'}
            checked={localDraft.supportsImageGeneration}
            onCheckedChange={(checked) =>
              updateDraft((current) =>
                withImageGenerationEnabled(current, checked, props.providerProtocol),
              )
            }
            testId="model-edit-image-generation"
          />
          <FieldCheckbox
            label={isChinese ? '视频' : 'Video generation'}
            checked={localDraft.supportsVideoGeneration}
            onCheckedChange={(checked) =>
              updateDraft((current) =>
                withVideoGenerationEnabled(current, checked, props.providerProtocol),
              )
            }
            testId="model-edit-video-generation"
          />
          <FieldCheckbox
            label={isChinese ? '实时语音（Live）' : 'Realtime voice (Live)'}
            checked={localDraft.supportsRealtimeAudio}
            onCheckedChange={(checked) =>
              updateDraft((current) => ({ ...current, supportsRealtimeAudio: checked }))
            }
            testId="model-edit-realtime-audio"
          />
        </div>

        <ModelGenerationRouteFields
          draft={localDraft}
          disabled={disabled}
          isChinese={isChinese}
          onChange={updateDraft}
        />

        <div className="model-edit-popover-footer">
          <Button
            type="button"
            variant="ghost"
            size="compact"
            onClick={() => setOpen(false)}
            data-testid="model-edit-cancel"
          >
            {isChinese ? '取消' : 'Cancel'}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="compact"
            onClick={handleSave}
            data-testid="model-edit-save"
          >
            {isChinese ? '保存' : 'Save'}
          </Button>
        </div>
      </div>
    </Popover>
  );
}
