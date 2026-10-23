import type { ReactElement } from 'react';
import type { ConversationPanePreset } from './conversation-pane-layout.js';

const PRESET_COUNTS = [1, 2, 4, 8] as const satisfies readonly ConversationPanePreset[];

export type ConversationPaneLayoutPresetsProps = {
  currentCount: number;
  locale: 'zh-CN' | 'en';
  onApplyPreset: (count: ConversationPanePreset) => void;
};

function presetLabel(count: ConversationPanePreset, locale: 'zh-CN' | 'en'): string {
  return locale === 'zh-CN'
    ? `${count} 个 Chat`
    : `${count} Chat${count === 1 ? '' : 's'}`;
}

export function ConversationPaneLayoutPresets(
  props: ConversationPaneLayoutPresetsProps,
): ReactElement {
  const isChinese = props.locale === 'zh-CN';
  return (
    <div className="conversation-pane-presets" data-testid="conversation-pane-presets">
      <span className="conversation-pane-presets-label">
        {isChinese ? '布局预设' : 'Layout presets'}
      </span>
      {PRESET_COUNTS.map((count) => {
        const active = props.currentCount === count;
        return (
          <button
            key={count}
            type="button"
            className={`conversation-pane-preset${active ? ' is-active' : ''}`}
            aria-pressed={active}
            onClick={() => props.onApplyPreset(count)}
          >
            {presetLabel(count, props.locale)}
          </button>
        );
      })}
    </div>
  );
}
