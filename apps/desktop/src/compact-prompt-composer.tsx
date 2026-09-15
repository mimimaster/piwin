/**
 * Shared prompt card for supplementary conversation panes.
 * Reuses the main composer card + model picker chrome so those surfaces can
 * type, pick a model, and send without a second input design.
 */
import { useCallback, useEffect, useMemo, useRef, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import type { ThinkingLevel } from '@piwin/contracts';
import { ComposerContextUsageControl } from './composer-context-controls.js';
import type { ContextRingViewModel } from './context-telemetry-selector.js';
import type { ModelOption } from './model-options.js';
import { IconSend, IconStop } from './shell-icons.js';
import { ThinkingEffortControl, toThinkingEffortModels } from './ThinkingEffortControl.js';

export type CompactPromptComposerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  testId: string;
  disabled?: boolean;
  streaming?: boolean;
  showStop?: boolean;
  sendLabel: string;
  stopLabel: string;
  sendTestId?: string;
  stopTestId?: string;
  onSend: () => void;
  onStop?: () => void;
  modelOptions: readonly ModelOption[];
  selectedModelKey: string;
  selectedModelLabel: string;
  thinkingLevel: ThinkingLevel;
  onSelectModel: (key: string) => void;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  modelPickerDisabled?: boolean;
  contextRingView?: ContextRingViewModel;
};

export function CompactPromptComposer(props: CompactPromptComposerProps): ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const lastCompositionEndRef = useRef(0);
  const canSend = props.value.trim().length > 0 && props.disabled !== true;
  const selectedModel = props.modelOptions.find(
    (model) => `${model.providerId}::${model.modelId}` === props.selectedModelKey,
  );
  const thinkingModels = useMemo(
    () => toThinkingEffortModels(props.modelOptions),
    [props.modelOptions],
  );

  const autoResize = useCallback(() => {
    const field = textareaRef.current;
    if (!field) return;
    requestAnimationFrame(() => {
      field.style.height = 'auto';
      field.style.height = `${Math.min(field.scrollHeight, 140)}px`;
    });
  }, []);

  useEffect(() => {
    autoResize();
  }, [autoResize, props.value]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!canSend) return;
    props.onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    const recentlyComposing =
      composingRef.current || Date.now() - lastCompositionEndRef.current < 100;
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !recentlyComposing &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (canSend) props.onSend();
    }
  }

  return (
    <form
      className="composer-card-v2 is-compact-session"
      data-testid="compact-prompt-composer"
      onSubmit={handleSubmit}
    >
      <div className="composer-v2-input-area">
        <textarea
          ref={textareaRef}
          className="composer-v2-textarea"
          data-testid={props.testId}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            lastCompositionEndRef.current = Date.now();
          }}
          onKeyDown={handleKeyDown}
          placeholder={props.placeholder}
          aria-label={props.ariaLabel}
          spellCheck={false}
          autoComplete="off"
          rows={1}
          disabled={props.disabled === true}
        />
      </div>
      <div className="composer-v2-toolbar">
        <div className="composer-v2-toolbar-left">
          <ThinkingEffortControl
            disabled={props.modelPickerDisabled === true || props.streaming === true}
            modelLabel={selectedModel?.label ?? props.selectedModelLabel}
            ultraEnabled={false}
            value={props.thinkingLevel}
            onChange={(level) => void props.onThinkingLevelChange(level)}
            models={thinkingModels}
            selectedModelKey={props.selectedModelKey}
            onSelectModel={props.onSelectModel}
          />
        </div>
        <div className="composer-v2-toolbar-right">
          {props.contextRingView ? (
            <ComposerContextUsageControl view={props.contextRingView} />
          ) : null}
          {props.showStop === true ? (
            <button
              type="button"
              className="composer-v2-stop-btn"
              data-testid={props.stopTestId ?? 'compact-prompt-stop'}
              aria-label={props.stopLabel}
              onClick={() => props.onStop?.()}
            >
              <IconStop width={15} height={15} />
            </button>
          ) : (
            <button
              type="submit"
              className="composer-v2-send-btn"
              data-testid={props.sendTestId ?? 'compact-prompt-send'}
              aria-label={props.sendLabel}
              disabled={!canSend}
            >
              <IconSend width={16} height={16} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
