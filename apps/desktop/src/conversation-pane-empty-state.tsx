import type { ReactElement } from 'react';
import { Button, Select } from '@piwin/ui-kit';
import type { SessionListItemUi } from './chat-reducer.js';
import { IconPlus } from './shell-icons.js';

export type ConversationPaneEmptyStateProps = {
  paneId: string;
  sessions: readonly SessionListItemUi[];
  creating: boolean;
  createDisabled: boolean;
  locale: 'zh-CN' | 'en';
  onCreate: (paneId: string) => void;
  onSelect: (paneId: string, sessionId: string) => void;
};

export function ConversationPaneEmptyState(props: ConversationPaneEmptyStateProps): ReactElement {
  return (
    <div className="conversation-pane-picker">
      <div className="conversation-pane-picker-icon" aria-hidden="true">
        <IconPlus width={18} height={18} />
      </div>
      <h3>{props.locale === 'zh-CN' ? '在这里打开 Chat' : 'Open a Chat here'}</h3>
      <p className="muted">
        {props.locale === 'zh-CN'
          ? '新建对话，或选择一个尚未显示的 Conversation。'
          : 'Start a new conversation or choose one not already visible.'}
      </p>
      <Button
        variant="primary"
        size="compact"
        disabled={props.createDisabled}
        onClick={() => props.onCreate(props.paneId)}
      >
        {props.creating
          ? props.locale === 'zh-CN'
            ? '正在创建…'
            : 'Creating…'
          : props.locale === 'zh-CN'
            ? '新建 Chat'
            : 'New Chat'}
      </Button>
      {props.sessions.length > 0 ? (
        <Select
          value=""
          aria-label={props.locale === 'zh-CN' ? '选择 Chat' : 'Choose a Chat'}
          onChange={(event) => {
            const sessionId = event.currentTarget.value;
            if (sessionId) props.onSelect(props.paneId, sessionId);
          }}
          data={[
            {
              value: '',
              label: props.locale === 'zh-CN' ? '选择已有 Chat…' : 'Choose existing Chat…',
            },
            ...props.sessions.map((session) => ({ value: session.id, label: session.name })),
          ]}
        />
      ) : null}
    </div>
  );
}
