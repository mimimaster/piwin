/**
 * Composer profile control: current model + thinking effort in one compact pill.
 * Opens a clean popover with labeled effort chips and a custom model list
 * (no native <select>, no unlabeled "Advanced" slider).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Popover } from '@piwin/ui-kit';
import type { ModelProviderConfig, ThinkingLevel } from '@piwin/contracts';
import { IconClose, IconSearch, IconSpark } from './shell-icons';
import { getSupportedThinkingLevels } from './model-thinking-policy';

type ThinkingEffortControlProps = {
  disabled: boolean;
  modelLabel: string;
  ultraEnabled: boolean;
  value: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  models?: Array<{
    key: string;
    label: string;
    protocol?: ModelProviderConfig['protocol'];
    thinkingLevels?: readonly ThinkingLevel[];
    reasoning?: boolean;
    supportsImage?: boolean;
    supportsImageGeneration?: boolean;
  }>;
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
  const effortLabel = formatThinkingLabel(effectiveValue);
  const isUltra = effectiveValue === 'ultra';
  const showThinking = levels.length > 0;

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

  useEffect(() => {
    if (!levels.includes(value) && value !== effectiveValue) {
      onChange(effectiveValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- levels derived from selectedModel/ultra
  }, [effectiveValue, onChange, value, levels]);

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
        {showThinking ? (
          /* Thinking / Reasoning Effort Section */
          <section className="thinking-effort-section">
            <header className="thinking-effort-section-title">
              <span>Thinking</span>
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
                    onClick={() => onChange(level)}
                    data-testid={`thinking-level-${level}`}
                  >
                    {formatThinkingLabel(level)}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* Model Selection Section */}
        <section className="thinking-effort-section">
          <header className="thinking-effort-section-title">
            <span>Model Engine</span>
          </header>
          {models.length === 0 ? (
            <div className="thinking-effort-model-empty" data-testid="thinking-model-empty">
              {modelLabel || 'No models configured'}
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
                      onSelectModel?.(filteredModels[0].key);
                    }
                  }}
                  placeholder="Search models…"
                  aria-label="Search models"
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
                        onClick={() => {
                          onSelectModel?.(model.key);
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
      </Popover>
    </div>
  );
}

function formatThinkingLabel(level: ThinkingLevel): string {
  if (level === 'off') {
    return 'Off';
  }
  if (level === 'xhigh') {
    return 'xHigh';
  }
  return level.charAt(0).toUpperCase() + level.slice(1);
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
