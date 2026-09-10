import { useLayoutEffect, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '@piwin/ui-kit';
import type { SessionSummary } from '@piwin/contracts';
import { RIGHT_PANEL_SIDE_CHAT_TABS_SLOT_ID } from './right-panel-chrome.js';
import { IconClose, IconSideChat } from './shell-icons.js';

export const SIDE_CHAT_DRAFT_TAB_ID = 'draft';

export type SideChatTabItem = {
  id: string;
  label: string;
  closable: boolean;
};

export function listSideChatTabs(
  sessions: readonly SessionSummary[],
  locale: 'zh-CN' | 'en',
): SideChatTabItem[] {
  const fallback = locale === 'zh-CN' ? '侧聊' : 'Side chat';
  if (sessions.length === 0) {
    return [{ id: SIDE_CHAT_DRAFT_TAB_ID, label: fallback, closable: true }];
  }
  return sessions.map((session) => {
    const name = session.name?.trim();
    return {
      id: session.id,
      label: name && name.length > 0 ? name : fallback,
      closable: true,
    };
  });
}

export type SideChatTabStripProps = {
  tabs: readonly SideChatTabItem[];
  activeId: string;
  locale: 'zh-CN' | 'en';
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
};

export function SideChatTabStrip(props: SideChatTabStripProps): ReactElement {
  const isChinese = props.locale === 'zh-CN';
  return (
    <div className="side-chat-tabstrip" data-testid="side-chat-tabstrip">
      <div className="side-chat-tabs" role="tablist" aria-label={isChinese ? '侧聊' : 'Side chats'}>
        {props.tabs.map((tab) => {
          const selected = tab.id === props.activeId;
          return (
            <div
              key={tab.id}
              className={`side-chat-tab${selected ? ' is-active' : ''}`}
              data-testid={`side-chat-tab-${tab.id}`}
            >
              <button
                type="button"
                className="side-chat-tab-main"
                role="tab"
                aria-selected={selected}
                onClick={() => props.onSelect(tab.id)}
              >
                <span className="side-chat-tab-icon" aria-hidden="true">
                  <IconSideChat width={14} height={14} />
                </span>
                <span className="side-chat-tab-label">{tab.label}</span>
              </button>
              {tab.closable ? (
                <IconButton
                  className="side-chat-tab-close"
                  size="xs"
                  label={isChinese ? `关闭 ${tab.label}` : `Close ${tab.label}`}
                  data-testid={`side-chat-close-tab-${tab.id}`}
                  onClick={() => props.onClose(tab.id)}
                >
                  <IconClose width={12} height={12} />
                </IconButton>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Prefer the right-panel titlebar slot so session tabs share that one row. */
export function SideChatTabStripPortal(props: SideChatTabStripProps): ReactElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [lookedUp, setLookedUp] = useState(false);
  useLayoutEffect(() => {
    setSlot(document.getElementById(RIGHT_PANEL_SIDE_CHAT_TABS_SLOT_ID));
    setLookedUp(true);
  }, []);
  const strip = <SideChatTabStrip {...props} />;
  if (slot) return createPortal(strip, slot);
  if (!lookedUp) return null;
  return strip;
}
