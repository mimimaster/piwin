/**
 * Composer controls for an external agent backend (ADR 0082).
 *
 * Pi's model/thinking pickers are backed by the global provider catalog. An
 * external agent has its *own* catalog, delivered per session as
 * `SessionBackendOptions`. This control renders exactly that list — model,
 * that model's efforts, and the agent's modes — and never mixes Pi model refs
 * into an agent session.
 *
 * `modeConfirmed === false` means the Host asked the agent to switch mode but
 * the agent has not confirmed yet; the pill shows a pending affordance rather
 * than a false "current mode".
 *
 * Reuses the composer pill + popover class system (`.thinking-effort-*`) so the
 * flyout keeps the same surface/elevation language as the Pi picker it replaces.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Popover } from '@piwin/ui-kit';
import type { BackendModelOption, SessionBackendOptions } from '@piwin/contracts';
import { IconClose, IconSearch, IconSpark } from './shell-icons';
import { useDesktopLocale } from './desktop-locale-context';

export type BackendComposerControlsProps = {
  options: SessionBackendOptions;
  /** Agent display name for aria labels ("Grok Build"). */
  agentLabel: string;
  disabled: boolean;
  onSelectModel: (modelId: string) => void;
  onSelectEffort: (effortId: string) => void;
  onSelectMode: (modeId: string) => void;
};

export function BackendComposerControls({
  options,
  agentLabel,
  disabled,
  onSelectModel,
  onSelectEffort,
  onSelectMode,
}: BackendComposerControlsProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [open, setOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const selectedModel = useMemo(
    () => options.models.find((model) => model.id === options.currentModelId),
    [options.models, options.currentModelId],
  );
  const efforts = selectedModel?.efforts ?? [];
  const selectedMode = options.modes.find((mode) => mode.id === options.currentModeId);

  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase();
    if (!query) {
      return options.models;
    }
    return options.models.filter((model) =>
      `${model.label} ${model.id} ${model.description ?? ''}`.toLocaleLowerCase().includes(query),
    );
  }, [options.models, modelQuery]);

  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    setModelQuery('');
    return undefined;
  }, [open]);

  const modelLabel = selectedModel?.label ?? options.currentModelId ?? agentLabel;
  const showMode = options.modes.length > 0;
  const modeLabel = selectedMode?.label ?? options.currentModeId;
  const modePending = showMode && !options.modeConfirmed;

  return (
    <div className="thinking-effort-control backend-composer-control">
      {options.autoApprove === true ? (
        <span
          className="backend-auto-approve-badge"
          data-testid="backend-auto-approve-badge"
          title={
            isZh
              ? `${agentLabel} 自行批准工具操作，不经过 piwin 逐条确认`
              : `${agentLabel} approves tool use on its own — piwin does not gate each step`
          }
        >
          {isZh ? '自动批准' : 'Auto'}
        </span>
      ) : null}

      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="start"
        label={isZh ? `${agentLabel} 模型与模式` : `${agentLabel} model and mode`}
        testId="backend-controls-popover"
        contentClassName="thinking-effort-popover"
        trigger={
          <button
            type="button"
            className="thinking-effort-trigger"
            disabled={disabled}
            data-testid="backend-controls-trigger"
            aria-label={isZh ? `${agentLabel} 模型 ${modelLabel}` : `${agentLabel} model ${modelLabel}`}
          >
            <span className="backend-composer-agent">{agentLabel}</span>
            <span className="thinking-effort-sep" aria-hidden>
              ·
            </span>
            <span className="thinking-effort-model">{modelLabel}</span>
            {showMode && modeLabel ? (
              <>
                <span className="thinking-effort-sep" aria-hidden>
                  ·
                </span>
                <span className="thinking-effort-value" data-testid="backend-mode-label">
                  {modePending ? `${modeLabel} …` : modeLabel}
                </span>
              </>
            ) : null}
            <span className="thinking-effort-chevron" aria-hidden />
          </button>
        }
      >
        {open ? (
          <>
            {showMode ? (
              <section className="thinking-effort-section">
                <header className="thinking-effort-section-title">
                  <span>{isZh ? '模式' : 'Mode'}</span>
                  {modePending ? (
                    <span
                      className="thinking-effort-active-tag"
                      data-testid="backend-mode-pending"
                    >
                      {isZh ? '等待确认' : 'Confirming…'}
                    </span>
                  ) : null}
                </header>
                <div className="thinking-effort-chip-row" role="radiogroup" aria-label="Mode">
                  {options.modes.map((mode) => {
                    const isActive = mode.id === options.currentModeId;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        className={
                          isActive ? 'thinking-effort-chip is-active' : 'thinking-effort-chip'
                        }
                        disabled={disabled}
                        onClick={() => onSelectMode(mode.id)}
                        title={mode.description ?? mode.label}
                        data-testid={`backend-mode-${mode.id}`}
                      >
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {efforts.length > 0 ? (
              <section className="thinking-effort-section">
                <header className="thinking-effort-section-title">
                  <span>{isZh ? '推理强度' : 'Effort'}</span>
                </header>
                <div className="thinking-effort-chip-row" role="radiogroup" aria-label="Effort">
                  {efforts.map((effortId) => {
                    const isActive = effortId === options.currentEffortId;
                    return (
                      <button
                        key={effortId}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        className={
                          isActive ? 'thinking-effort-chip is-active' : 'thinking-effort-chip'
                        }
                        disabled={disabled}
                        onClick={() => onSelectEffort(effortId)}
                        data-testid={`backend-effort-${effortId}`}
                      >
                        {effortId}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="thinking-effort-section">
              <header className="thinking-effort-section-title">
                <span>{isZh ? '模型' : 'Model'}</span>
              </header>
              <div className="thinking-effort-model-search">
                <IconSearch width={13} height={13} aria-hidden />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder={isZh ? '搜索模型…' : 'Search models…'}
                  aria-label={isZh ? '搜索模型' : 'Search models'}
                  data-testid="backend-model-search-input"
                  disabled={disabled}
                  spellCheck={false}
                  autoComplete="off"
                />
                {modelQuery ? (
                  <button
                    type="button"
                    className="thinking-effort-model-search-clear"
                    aria-label="Clear model search"
                    disabled={disabled}
                    onClick={() => setModelQuery('')}
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
                  data-testid="backend-model-select"
                >
                  {filteredModels.map((model) => (
                    <BackendModelRow
                      key={model.id}
                      model={model}
                      selected={model.id === options.currentModelId}
                      disabled={disabled}
                      onSelect={onSelectModel}
                    />
                  ))}
                </div>
              ) : (
                <div className="thinking-effort-model-no-results" data-testid="backend-model-no-results">
                  {isZh
                    ? `没有匹配 “${modelQuery.trim()}” 的模型`
                    : `No models match “${modelQuery.trim()}”`}
                </div>
              )}
            </section>
          </>
        ) : null}
      </Popover>
    </div>
  );
}

function BackendModelRow(props: {
  model: BackendModelOption;
  selected: boolean;
  disabled: boolean;
  onSelect: (modelId: string) => void;
}): ReactElement {
  const { model, selected, disabled, onSelect } = props;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={
        selected
          ? 'thinking-effort-model-option is-selected'
          : 'thinking-effort-model-option'
      }
      disabled={disabled}
      onPointerDown={(event) => {
        // The autofocused search blurs on pointerdown; keep the popover
        // mounted through the click that follows.
        if (event.button === 0) {
          event.preventDefault();
        }
      }}
      onClick={() => onSelect(model.id)}
      title={model.description ?? model.label}
      data-testid={`backend-model-${model.id}`}
    >
      <span className="thinking-effort-model-icon" aria-hidden>
        <IconSpark width={14} height={14} />
      </span>
      <span className="thinking-effort-model-info">
        <span className="thinking-effort-model-option-label">{model.label}</span>
        {model.contextTokens !== undefined ? (
          <span className="thinking-effort-model-provider-badge">
            {formatContextTokens(model.contextTokens)}
          </span>
        ) : null}
      </span>
      {selected ? (
        <span className="thinking-effort-model-check" aria-hidden>
          ✓
        </span>
      ) : null}
    </button>
  );
}

/** 200000 → "200K"; a locale-independent compact context-window label. */
function formatContextTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return String(tokens);
}
