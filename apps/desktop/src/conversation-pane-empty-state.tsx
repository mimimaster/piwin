import type { ReactElement } from 'react';
import { IconPlus } from './shell-icons.js';

export type ConversationPaneEmptyStateProps = {
  paneId: string;
  creating: boolean;
  createDisabled: boolean;
  locale: 'zh-CN' | 'en';
  onCreate: (paneId: string) => void;
};

export function ConversationPaneEmptyState(props: ConversationPaneEmptyStateProps): ReactElement {
  const isChinese = props.locale === 'zh-CN';
  return (
    <div className="conversation-pane-picker">
      <button
        type="button"
        className="conversation-pane-picker-open"
        disabled={props.createDisabled}
        onClick={() => props.onCreate(props.paneId)}
      >
        <span className="conversation-pane-picker-icon" aria-hidden="true">
          <IconPlus width={14} height={14} />
        </span>
        <b>
          {props.creating
            ? isChinese
              ? '正在创建…'
              : 'Creating…'
            : isChinese
              ? '在这里打开 Chat'
              : 'Open a Chat here'}
        </b>
        <span>
          {isChinese
            ? '新建对话，或选择尚未显示的会话'
            : 'Create a conversation, or pick one that is not already visible.'}
        </span>
      </button>
    </div>
  );
}
