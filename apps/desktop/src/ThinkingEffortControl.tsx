/**
 * Composer profile control: current model + thinking effort in one compact pill.
 * Opens a clean popover with labeled effort chips and a custom model list
 * (no native <select>, no unlabeled "Advanced" slider).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Popover } from '@piwin/ui-kit';
import type { ModelProviderConfig, ModelSource, ThinkingLevel } from '@piwin/contracts';
import { formatComposerModelKey } from './composer-model-selection-policy';
import { IconClose, IconSearch, IconSpark } from './shell-icons';
import { getSupportedThinkingLevels } from './model-thinking-policy';
import { useDesktopLocale } from './desktop-locale-context';
import { formatThinkingLabel } from './usage-panel-statistics.js';

export type ThinkingEffortModelOption = {
  key: string;
  label: string;
  providerId?: string;
  source?: ModelSource;
  protocol?: ModelProviderConfig['protocol'];
  thinkingLevels?: readonly ThinkingLevel[];
  reasoning?: boolean;
  supportsImage?: boolean;
  supportsImageGeneration?: boolean;
};

type ComposerLikeModel = {
  providerId: string;
  modelId: string;
  label: string;
  source?: ModelSource;
  protocol?: ModelProviderConfig['protocol'];
  thinkingLevels?: readonly ThinkingLevel[];
  reasoning?: boolean;
  supportsImage?: boolean;
  supportsImageGeneration?: boolean;
};

/** Flatten composer/session model rows into the picker list the control renders. */
export function toThinkingEffortModels(
  models: readonly ComposerLikeModel[],
): ThinkingEffortModelOption[] {
  return models.map((model) => ({
    key: formatComposerModelKey(model.providerId, model.modelId),
    label: model.label,
    providerId: model.providerId,
    ...(model.source !== undefined ? { source: model.source } : {}),
    ...(model.protocol !== undefined ? { protocol: model.protocol } : {}),
    ...(model.thinkingLevels !== undefined ? { thinkingLevels: model.thinkingLevels } : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.supportsImage ? { supportsImage: true } : {}),
    ...(model.supportsImageGeneration ? { supportsImageGeneration: true } : {}),
  }));
}

type ThinkingEffortControlProps = {
  disabled: boolean;
  modelLabel: string;
  ultraEnabled: boolean;
  value: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  models?: ThinkingEffortModelOption[];
  selectedModelKey?: string;
  onSelectModel?: (key: string) => void;
};

export function ThinkingEffortControl({
  disabled,
  modelLabel,
  ultraEnabled,
  value,
  onChange,
  models = [],
  selectedModelKey = '',
  onSelectModel,
}: ThinkingEffortControlProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [open, setOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const selectedModel = useMemo(
    () => models.find((model) => model.key === selectedModelKey),
    [models, selectedModelKey],
  );
  const filteredModels = useMemo(() => {
    const query = modelSearchQuery.trim().toLocaleLowerCase();
    if (!query) {
      return models;
    }
    return models.filter((model) => {
      const { provider, name } = parseModelLabel(model.label);
      const haystack = [model.label, provider ?? '', name].join(' ').toLocaleLowerCase();
      return haystack.includes(query);
    });
  }, [models, modelSearchQuery]);
  const levels = getSupportedThinkingLevels(selectedModel, ultraEnabled);
  const effectiveValue = levels.includes(value) ? value : (levels[0] ?? 'off');
  const shortModelLabel = shortenModelLabel(modelLabel);
  const effortLabel = formatThinkingLabel(effectiveValue, isZh);
  const isUltra = effectiveValue === 'ultra';
  const showThinking = levels.length > 0;

  function chooseModel(key: string): void {
    onSelectModel?.(key);
    setOpen(false);
  }

  function keepPopoverThroughPointer(event: { button: number; preventDefault: () => void }): void {
    // Autofocused search blurs on option pointerdown; Radix then treats the
    // interaction as focus-outside and unmounts the popover before `click`.
    if (event.button === 0) {
      event.preventDefault();
    }
  }

  // Put the caret in the search field on open; reset the query on close so the
  // next open starts from a clean, unfiltered list.
  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    setModelSearchQuery('');
    return undefined;
  }, [open]);

  // Radix owns outside-pointer dismissal, Escape, and focus return to the trigger.
  return (
    <div className={isUltra ? 'thinking-effort-control ultra-active' : 'thinking-effort-control'}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="start"
        label="Model and thinking"
        testId="thinking-effort-popover"
        contentClassName={
          isUltra ? 'thinking-effort-popover ultra-active' : 'thinking-effort-popover'
        }
        trigger={
          <button
            type="button"
            className="thinking-effort-trigger"
            disabled={disabled}
            aria-label={`Model ${modelLabel}${showThinking ? `, thinking ${effortLabel}` : ''}`}
            data-testid="thinking-effort-trigger"
          >
            <span className="thinking-effort-model">{shortModelLabel}</span>
            {showThinking ? (
              <>
                <span className="thinking-effort-sep" aria-hidden>
                  ·
                </span>
                <span className="thinking-effort-value">{effortLabel}</span>
              </>
            ) : null}
            <span className="thinking-effort-chevron" aria-hidden />
          </button>
        }
      >
        {/* Radix unmounts closed content; skip building the model list JSX on every
            parent render (streaming commits re-render the composer). */}
        {open ? (
          <>
            {showThinking ? (
              /* Thinking / Reasoning Effort Section */
              <section className="thinking-effort-section">
                <header className="thinking-effort-section-title">
                  <span>{isZh ? '思考' : 'Thinking'}</span>
                  <span className="thinking-effort-active-tag">{effortLabel}</span>
                </header>
                <div
                  className="thinking-effort-chip-row"
                  role="radiogroup"
                  aria-label="Thinking effort"
                >
                  {levels.map((level) => {
                    const isActive = level === effectiveValue;
                    return (
                      <button
                        key={level}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        className={isActive ? 'thinking-effort-chip is-active' : 'thinking-effort-chip'}
                        disabled={disabled}
                        onPointerDown={keepPopoverThroughPointer}
                        onClick={() => onChange(level)}
                        data-testid={`thinking-level-${level}`}
                      >
                        {formatThinkingLabel(level, isZh)}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {/* Model Selection Section */}
            <section className="thinking-effort-section">
              <header className="thinking-effort-section-title">
                <span>{isZh ? '模型' : 'Model Engine'}</span>
              </header>
              {models.length === 0 ? (
                <div className="thinking-effort-model-empty" data-testid="thinking-model-empty">
                  {modelLabel || (isZh ? '未配置模型' : 'No models configured')}
                </div>
              ) : (
                <>
                  {/* Model search / filter */}
                  <div className="thinking-effort-model-search">
                    <IconSearch width={13} height={13} aria-hidden />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={modelSearchQuery}
                      onChange={(event) => setModelSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && filteredModels[0]) {
                          chooseModel(filteredModels[0].key);
                        }
                      }}
                      placeholder={isZh ? '搜索模型…' : 'Search models…'}
                      aria-label={isZh ? '搜索模型' : 'Search models'}
                      data-testid="thinking-model-search-input"
                      disabled={disabled}
                      spellCheck={false}
                      autoComplete="off"
                    />
                    {modelSearchQuery ? (
                      <button
                        type="button"
                        className="thinking-effort-model-search-clear"
                        aria-label="Clear model search"
                        data-testid="thinking-model-search-clear"
                        disabled={disabled}
                        onClick={() => setModelSearchQuery('')}
                      >
                        <IconClose width={12} height={12} />
                      </button>
                    ) : null}
                  </div>

                  {filteredModels.length > 0 ? (
                    <div
                      className="thinking-effort-model-list"
                      role="listbox"
                      aria-label="Model"
                      data-testid="thinking-model-select"
                    >
                      {filteredModels.map((model) => {
                        const isSelected = model.key === selectedModelKey;
                        const { provider, name } = parseModelLabel(model.label);
                        return (
                          <button
                            key={model.key}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={
                              isSelected
                                ? 'thinking-effort-model-option is-selected'
                                : 'thinking-effort-model-option'
                            }
                            disabled={disabled}
                            onPointerDown={(event) => {
                              keepPopoverThroughPointer(event);
                              if (event.button === 0) {
                                chooseModel(model.key);
                              }
                            }}
                            title={model.label}
                          >
                            <span className="thinking-effort-model-icon" aria-hidden>
                              <IconSpark width={14} height={14} />
                            </span>
                            <span className="thinking-effort-model-info">
                              <span className="thinking-effort-model-option-label">
                                {name}
                                {model.supportsImage ? (
                                  <span
                                    className="thinking-effort-model-vision-tag"
                                    data-testid={`model-vision-tag-${model.key}`}
                                    title="Vision"
                                  >
                                    {' '}
                                    · vision
                                  </span>
                                ) : null}
                                {model.reasoning ? (
                                  <span
                                    className="thinking-effort-model-reason-tag"
                                    data-testid={`model-reason-tag-${model.key}`}
                                    title="Reasoning"
                                  >
                                    {' '}
                                    · reason
                                  </span>
                                ) : null}
                                {model.supportsImageGeneration ? (
                                  <span
                                    className="thinking-effort-model-image-gen-tag"
                                    data-testid={`model-image-gen-tag-${model.key}`}
                                    title="Image generation"
                                  >
                                    {' '}
                                    · image-gen
                                  </span>
                                ) : null}
                              </span>
                              {provider ? (
                                <span className="thinking-effort-model-provider-badge">{provider}</span>
                              ) : null}
                            </span>
                            {isSelected ? (
                              <span className="thinking-effort-model-check" aria-hidden>
                                ✓
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className="thinking-effort-model-no-results"
                      data-testid="thinking-model-no-results"
                    >
                      No models match “{modelSearchQuery.trim()}”
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        ) : null}
      </Popover>
    </div>
  );
}

/** Compact pill label; full name stays in the model list. */
function shortenModelLabel(label: string): string {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    return 'Model';
  }
  // "Cpa / deepseek-v4-flash" → prefer the model segment after " / ".
  const slashParts = trimmedLabel.split(/\s*\/\s*/);
  const preferred = slashParts.length > 1 ? slashParts[slashParts.length - 1]! : trimmedLabel;
  const lastSegment = preferred.includes('/')
    ? preferred.slice(preferred.lastIndexOf('/') + 1)
    : preferred;
  if (lastSegment.length <= 20) {
    return lastSegment;
  }
  return `${lastSegment.slice(0, 19)}…`;
}

function parseModelLabel(label: string): { provider: string | null; name: string } {
  const trimmed = label.trim();
  if (!trimmed) {
    return { provider: null, name: 'Model' };
  }
  const slashParts = trimmed.split(/\s*\/\s*/);
  if (slashParts.length > 1 && slashParts[0]) {
    return {
      provider: slashParts[0],
      name: slashParts.slice(1).join(' / '),
    };
  }
  return { provider: null, name: trimmed };
}
