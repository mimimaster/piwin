import type { ReactElement } from 'react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  IconButton,
} from '@piwin/ui-kit';
import type { SessionListItemUi } from './chat-reducer.js';
import {
  IconArrowDown,
  IconChevronDown,
  IconClose,
  IconCompress,
  IconExpand,
  IconPanelLeft,
  IconPanelRight,
} from './shell-icons.js';
import type {
  ConversationPaneOrientation,
  ConversationPanePreset,
} from './conversation-pane-layout.js';

export type ConversationPaneHeaderProps = {
  paneId: string;
  index: number;
  title: string;
  active: boolean;
  maximized: boolean;
  closable: boolean;
  splitDisabled: boolean;
  locale: 'zh-CN' | 'en';
  sessionId?: string | null;
  sessions?: readonly SessionListItemUi[];
  onApplyPreset: (count: ConversationPanePreset) => void;
  onSplit: (paneId: string, orientation: ConversationPaneOrientation) => void;
  onToggleMaximized: (paneId: string) => void;
  onClose: (paneId: string) => void;
  onSelectSession?: (paneId: string, sessionId: string) => void;
  onCreateSession?: (paneId: string) => void;
};

export function ConversationPaneHeader(props: ConversationPaneHeaderProps): ReactElement {
  const isChinese = props.locale === 'zh-CN';
  const availableSessions = props.sessions ?? [];

  return (
    <header
      className="conversation-pane-header"
      onDoubleClick={(event) => {
        if (
          (event.target as HTMLElement).closest(
            'button, [role="menuitem"], [data-prevent-zoom="true"]',
          )
        ) {
          return;
        }
        props.onToggleMaximized(props.paneId);
      }}
      title={
        props.maximized
          ? isChinese
            ? '双击还原窗格 (Esc)'
            : 'Double click to restore pane (Esc)'
          : isChinese
            ? '双击最大化窗格'
            : 'Double click to maximize pane'
      }
    >
      <span className="conversation-pane-index" aria-hidden="true">
        {props.index + 1}
      </span>
      {props.onSelectSession || props.onCreateSession ? (
        <DropdownMenu
          modal={false}
          align="start"
          label={props.title}
          trigger={
            <button
              type="button"
              className="conversation-pane-title-button"
              title={isChinese ? '切换会话' : 'Switch Chat'}
              data-prevent-zoom="true"
            >
              <span className="conversation-pane-title-text">{props.title}</span>
              <IconChevronDown width={12} height={12} className="conversation-pane-title-arrow" />
            </button>
          }
        >
          <DropdownMenuLabel>{isChinese ? '切换会话' : 'Switch Chat'}</DropdownMenuLabel>
          {availableSessions.length > 0 ? (
            availableSessions.slice(0, 15).map((session) => (
              <DropdownMenuItem
                key={session.id}
                onSelect={() => props.onSelectSession?.(props.paneId, session.id)}
              >
                <span className="conversation-pane-menu-item">
                  {session.name || (isChinese ? '未命名 Chat' : 'Untitled Chat')}
                  {session.id === props.sessionId ? ' ✓' : ''}
                </span>
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled>
              <span className="conversation-pane-menu-item" style={{ opacity: 0.6 }}>
                {isChinese ? '暂无其他会话' : 'No other sessions'}
              </span>
            </DropdownMenuItem>
          )}
          {props.onCreateSession ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => props.onCreateSession?.(props.paneId)}>
                {isChinese ? '+ 新建 Chat' : '+ New Chat'}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenu>
      ) : (
        <span className="conversation-pane-title" title={props.title}>
          {props.title}
        </span>
      )}
      <span className="conversation-pane-active-label">
        {props.active ? (isChinese ? '当前' : 'Active') : null}
      </span>
      <div
        className="conversation-pane-actions"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu
          modal={false}
          align="end"
          label={isChinese ? 'Chat 布局' : 'Chat layout'}
          trigger={
            <IconButton label={isChinese ? 'Chat 布局' : 'Chat layout'}>
              <IconPanelLeft width={15} height={15} />
            </IconButton>
          }
        >
          <DropdownMenuLabel>{isChinese ? '布局预设' : 'Layout presets'}</DropdownMenuLabel>
          {([1, 2, 4, 8] as const).map((count) => (
            <DropdownMenuItem key={count} onSelect={() => props.onApplyPreset(count)}>
              {isChinese ? `${count} 个 Chat` : `${count} Chat${count === 1 ? '' : 's'}`}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => props.onSplit(props.paneId, 'row')} shortcut="⌘D">
            {isChinese ? '向右拆分' : 'Split right'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => props.onSplit(props.paneId, 'column')} shortcut="⇧⌘D">
            {isChinese ? '向下拆分' : 'Split down'}
          </DropdownMenuItem>
        </DropdownMenu>
        <IconButton
          label={isChinese ? '向右拆分' : 'Split right'}
          className="is-split-action"
          onClick={() => props.onSplit(props.paneId, 'row')}
          disabled={props.splitDisabled}
        >
          <IconPanelRight width={15} height={15} />
        </IconButton>
        <IconButton
          label={isChinese ? '向下拆分' : 'Split down'}
          className="is-split-action"
          onClick={() => props.onSplit(props.paneId, 'column')}
          disabled={props.splitDisabled}
        >
          <IconArrowDown width={15} height={15} />
        </IconButton>
        <IconButton
          label={
            props.maximized
              ? isChinese
                ? '恢复窗格'
                : 'Restore pane'
              : isChinese
                ? '最大化窗格'
                : 'Maximize pane'
          }
          onClick={() => props.onToggleMaximized(props.paneId)}
        >
          {props.maximized ? (
            <IconCompress width={15} height={15} />
          ) : (
            <IconExpand width={15} height={15} />
          )}
        </IconButton>
        {props.closable ? (
          <IconButton
            label={isChinese ? '关闭窗格' : 'Close pane'}
            onClick={() => props.onClose(props.paneId)}
          >
            <IconClose width={15} height={15} />
          </IconButton>
        ) : null}
      </div>
    </header>
  );
}
