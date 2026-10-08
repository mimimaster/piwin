import type { ReactElement } from 'react';
import { SegmentedControl } from '@piwin/ui-kit';
import type { ConversationSurface } from './conversation-surface';
import type { DesktopLocale } from './desktop-locale';

/** Switch the conversation area between Desktop's chat and the terminal shell. */
export function ConversationSurfaceToggle(props: {
  surface: ConversationSurface;
  locale: DesktopLocale;
  onChange: (surface: ConversationSurface) => void;
}): ReactElement {
  const zh = props.locale === 'zh-CN';
  return (
    <div className="conversation-surface-toggle" data-testid="conversation-surface-toggle">
      <SegmentedControl
        size="xs"
        aria-label={zh ? '对话区显示方式' : 'Conversation surface'}
        value={props.surface}
        onChange={(value) => props.onChange(value === 'tui' ? 'tui' : 'chat')}
        data={[
          { value: 'chat', label: zh ? '对话' : 'Chat' },
          { value: 'tui', label: zh ? '终端' : 'Terminal' },
        ]}
      />
    </div>
  );
}
