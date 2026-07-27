/**
 * Composer profile control: current model + thinking effort in one compact pill.
 * Opens a clean popover with labeled effort chips and a custom model list
 * (no native <select>, no unlabeled "Advanced" slider).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Popover } from '@piwin/ui-kit';
import type { ModelRef, ThinkingLevel } from '@piwin/contracts';

type ThinkingEffortControlProps = {
  disabled: boolean;
  modelLabel: string;
  protocol: ModelRef['protocol'] | null;
  ultraEnabled: boolean;
  value: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  models?: Array<{ key: string; label: string; protocol?: ModelRef['protocol'] }>;
  selectedModelKey?: string;
  onSelectModel?: (key: string) => void;
};

const OPENAI_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const ANTHROPIC_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'max'];
const GEMINI_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high'];

export function ThinkingEffortControl({
  disabled,
  modelLabel,
  protocol,
  ultraEnabled,
  value,
  onChange,
  models = [],
  selectedModelKey = '',
  onSelectModel,
}: ThinkingEffortControlProps): ReactElement {
  const [open, setOpen] = useState(false);
  const levels = getThinkingLevels(protocol, ultraEnabled);
  const effectiveValue = levels.includes(value) ? value : getDefaultThinkingLevel(protocol);
  const shortModelLabel = shortenModelLabel(modelLabel);
  const effortLabel = formatThinkingLabel(effectiveValue);
  const isUltra = effectiveValue === 'ultra';

  useEffect(() => {
    if (!levels.includes(value) && value !== effectiveValue) {
      onChange(effectiveValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- levels derived from protocol/ultra
  }, [effectiveValue, onChange, protocol, ultraEnabled, value]);

  // Radix owns outside-pointer dismissal, Escape, and focus return to the trigger.
  return (
    <div
      className={isUltra ? 'thinking-effort-control ultra-active' : 'thinking-effort-control'}
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
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
            aria-label={`Model ${modelLabel}, thinking ${effortLabel}`}
            data-testid="thinking-effort-trigger"
          >
            <span className="thinking-effort-model">{shortModelLabel}</span>
            <span className="thinking-effort-sep" aria-hidden>
              ·
            </span>
            <span className="thinking-effort-value">{effortLabel}</span>
            <span className="thinking-effort-chevron" aria-hidden />
          </button>
        }
      >
        <section className="thinking-effort-section">
          <header className="thinking-effort-section-title">Thinking</header>
          <div className="thinking-effort-chip-row" role="radiogroup" aria-label="Thinking effort">
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

        <section className="thinking-effort-section">
          <header className="thinking-effort-section-title">Model</header>
          {models.length === 0 ? (
            <div className="thinking-effort-model-empty" data-testid="thinking-model-empty">
              {modelLabel || 'No models configured'}
            </div>
          ) : (
            <div
              className="thinking-effort-model-list"
              role="listbox"
              aria-label="Model"
              data-testid="thinking-model-select"
            >
              {models.map((model) => {
                const isSelected = model.key === selectedModelKey;
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
                    <span className="thinking-effort-model-option-label">{model.label}</span>
                    {isSelected ? (
                      <span className="thinking-effort-model-check" aria-hidden>
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </Popover>
    </div>
  );
}

function getThinkingLevels(
  protocol: ModelRef['protocol'] | null,
  ultraEnabled: boolean,
): ThinkingLevel[] {
  const baseLevels =
    protocol === 'anthropic-compatible'
      ? ANTHROPIC_LEVELS
      : protocol === 'google-gemini'
        ? GEMINI_LEVELS
        : OPENAI_LEVELS;
  return ultraEnabled ? [...baseLevels, 'ultra'] : baseLevels;
}

function getDefaultThinkingLevel(protocol: ModelRef['protocol'] | null): ThinkingLevel {
  return protocol === 'anthropic-compatible' ? 'high' : 'medium';
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
  const preferred =
    slashParts.length > 1 ? slashParts[slashParts.length - 1]! : trimmedLabel;
  const lastSegment = preferred.includes('/')
    ? preferred.slice(preferred.lastIndexOf('/') + 1)
    : preferred;
  if (lastSegment.length <= 20) {
    return lastSegment;
  }
  return `${lastSegment.slice(0, 19)}…`;
}
