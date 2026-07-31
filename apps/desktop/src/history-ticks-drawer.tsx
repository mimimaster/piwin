/**
 * Translucent history scale ticks bar for transcript viewport.
 * Interaction flow:
 * 1. Collapsed: Equal-length (等长) tick lines attached to left border. Click opens drawer ONLY (no jump yet).
 * 2. Expanded: Drawer pulls out, tick lines have dynamic lengths (不定长) based on message text length.
 *    Hovering any tick displays the message bubble popover with matching surface background & text colors.
 * 3. Click tick inside drawer: Jumps/scrolls to target user message in transcript.
 */
import { useState, useMemo, type ReactElement } from 'react';
import type { ChatMessageUi } from './chat-reducer';

export type HistoryTicksDrawerProps = {
  messages?: ChatMessageUi[] | undefined;
};

export function formatRelativeTime(createdAt?: string, now: Date = new Date()): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (isNaN(date.getTime())) return '';
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return '0m';
  const diffMin = Math.floor(diffMs / (1000 * 60));
  if (diffMin < 1) return '<1m';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

export function formatFullTimestamp(createdAt?: string): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (isNaN(date.getTime())) return '';
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${month} ${day}, ${hours}:${minutes} ${ampm}`;
}

export function truncateMessageText(text: string, maxLength: number = 100): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

/**
 * Calculates a dynamic tick length (px) proportional to message text length.
 * Clamped between minWidth and maxWidth. (Used inside expanded drawer only).
 */
export function getDynamicTickWidth(text: string, minWidth: number, maxWidth: number): number {
  const len = text.trim().length;
  // Normalize length up to ~80 chars max
  const ratio = Math.min(Math.max(len / 80, 0), 1);
  return Math.round(minWidth + (maxWidth - minWidth) * ratio);
}

export function HistoryTicksDrawer({ messages = [] }: HistoryTicksDrawerProps): ReactElement | null {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const userMessages = useMemo(() => {
    return messages.filter((m) => m.role === 'user' && m.text.trim().length > 0);
  }, [messages]);

  if (userMessages.length === 0) {
    return null;
  }

  const now = new Date();

  function handleTickJump(messageId: string): void {
    const targetElem = document.getElementById(`msg-${messageId}`);
    if (targetElem) {
      targetElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetElem.classList.add('highlight-target');
      window.setTimeout(() => {
        targetElem.classList.remove('highlight-target');
      }, 2000);
    }
  }

  // Active preview message in expanded state is either hovered tick or selected tick
  const displayMessageId = isExpanded ? (hoveredMessageId || activeMessageId) : null;
  const previewMessage = userMessages.find((m) => m.id === displayMessageId);

  return (
    <div
      className={`history-ticks-drawer ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}
      onMouseLeave={() => {
        setIsExpanded(false);
        setHoveredMessageId(null);
        setActiveMessageId(null);
      }}
      data-testid="history-ticks-drawer"
    >
      {!isExpanded ? (
        <div
          className="history-ticks-border-strip"
          data-testid="history-drawer-handle"
        >
          <div className="border-ticks-list">
            {userMessages.map((msg) => {
              const isHovered = msg.id === hoveredMessageId;

              return (
                <span
                  key={msg.id}
                  className={`border-tick-line ${isHovered ? 'is-hovered' : ''}`}
                  onMouseEnter={() => setHoveredMessageId(msg.id)}
                  onMouseOver={() => setHoveredMessageId(msg.id)}
                  onMouseLeave={() => setHoveredMessageId(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Click collapsed tick: Open drawer ONLY (equal length collapsed ticks)
                    setIsExpanded(true);
                    setActiveMessageId(msg.id);
                    setHoveredMessageId(msg.id);
                  }}
                  role="button"
                  tabIndex={0}
                  title="Click to open history drawer"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setIsExpanded(true);
                      setActiveMessageId(msg.id);
                    }
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : (
        <div
          className="history-drawer-panel"
          data-testid="history-drawer-panel"
        >
          <div className="history-ticks-container">
            <div className="history-ticks-track">
              {userMessages.map((msg, index) => {
                const relativeTime = formatRelativeTime(msg.createdAt, now) || `#${index + 1}`;
                const isCurrent = msg.id === (hoveredMessageId || activeMessageId);
                // Dynamic length ONLY inside expanded drawer!
                const linePx = getDynamicTickWidth(msg.text, 18, 44);

                return (
                  <div
                    key={msg.id}
                    className={`history-tick-item ${isCurrent ? 'is-hovered' : ''}`}
                    onMouseEnter={() => setHoveredMessageId(msg.id)}
                    onMouseOver={() => setHoveredMessageId(msg.id)}
                    onClick={() => {
                      // Click tick inside drawer: Scroll & jump to message
                      setActiveMessageId(msg.id);
                      handleTickJump(msg.id);
                    }}
                    data-testid={`history-tick-${msg.id}`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setActiveMessageId(msg.id);
                        handleTickJump(msg.id);
                      }
                    }}
                  >
                    <span className="history-tick-label">{relativeTime}</span>
                    <span
                      className="history-tick-line"
                      style={{ width: `${linePx}px` }}
                    />
                  </div>
                );
              })}
            </div>

            {previewMessage ? (
              <div className="history-message-bubble" data-testid="history-message-bubble">
                <div className="history-bubble-header">
                  {formatFullTimestamp(previewMessage.createdAt) || 'User Message'}
                </div>
                <div className="history-bubble-text">
                  {truncateMessageText(previewMessage.text, 120)}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
