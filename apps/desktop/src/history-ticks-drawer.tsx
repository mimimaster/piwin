/**
 * Translucent history scale ticks bar for transcript viewport.
 * Interaction flow:
 * 1. Collapsed: Equal-length (等长) tick lines attached to left border. Click pins the drawer open.
 * 2. Expanded: Drawer pulls out, tick lines have dynamic lengths (不定长) based on message text length.
 *    Hovering any tick displays a transient message bubble (clears on leave — does not freeze open).
 * 3. Click tick inside drawer: Jumps/scrolls to target user message in transcript.
 * 4. Pinned until Escape, click outside, or the close control — mouse leave does not collapse.
 * 5. Session change (first user message id) unpins and clears selection.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type RefObject,
  type ReactElement,
} from 'react';
import type { ChatMessageUi } from './chat-reducer';
import { IconClose } from './shell-icons';

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
  /** Click pins open; not collapsed by mouse leave. */
  const [isPinnedOpen, setIsPinnedOpen] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const userMessages = useMemo(() => {
    return messages.filter((m) => m.role === 'user' && m.text.trim().length > 0);
  }, [messages]);

  const unpinClose = useCallback((): void => {
    setIsPinnedOpen(false);
    setHoveredMessageId(null);
    setActiveMessageId(null);
  }, []);

  // Switching sessions replaces the message list; never leave a pinned drawer
  // open against a different conversation (reads as a frozen overlay).
  const firstUserMessageId = userMessages[0]?.id;
  useEffect(() => {
    unpinClose();
  }, [firstUserMessageId, unpinClose]);

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
    // Keep the drawer usable after jump; scroll the active tick into view if needed.
    const tickButton = rootRef.current?.querySelector(
      `[data-testid="history-tick-${messageId}"]`,
    );
    if (tickButton instanceof HTMLElement) {
      tickButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function pinOpen(messageId?: string): void {
    setIsPinnedOpen(true);
    if (messageId) {
      setActiveMessageId(messageId);
      setHoveredMessageId(messageId);
    }
  }

  // Preview bubble is hover-only so it cannot freeze over the transcript.
  const previewMessage = isPinnedOpen
    ? userMessages.find((message) => message.id === hoveredMessageId)
    : undefined;

  return (
    <div
      ref={rootRef}
      className={`history-ticks-drawer ${isPinnedOpen ? 'is-expanded is-pinned' : 'is-collapsed'}`}
      onMouseLeave={() => {
        // Keep pin; only clear transient hover highlight when leaving the bar.
        setHoveredMessageId(null);
      }}
      onMouseOut={(event) => {
        // Fallback for environments where mouseleave is not dispatched reliably.
        // Keep pin; only clear hover when the pointer truly left the drawer.
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
          return;
        }
        setHoveredMessageId(null);
      }}
      data-testid="history-ticks-drawer"
    >
      {!isPinnedOpen ? (
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
                    // Click collapsed tick: pin drawer open (no jump yet).
                    pinOpen(msg.id);
                  }}
                  role="button"
                  tabIndex={0}
                  title="Click to pin history ticks"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      pinOpen(msg.id);
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
          <div className="history-drawer-panel-head">
            <span className="history-drawer-panel-title">History</span>
            <button
              type="button"
              className="history-drawer-close"
              data-testid="history-drawer-close"
              title="Close"
              aria-label="Close history ticks"
              onClick={(event) => {
                event.stopPropagation();
                unpinClose();
              }}
            >
              <IconClose width={10} height={10} />
            </button>
          </div>
          <div className="history-ticks-container">
            <div className="history-ticks-track" data-testid="history-ticks-track">
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
                        e.preventDefault();
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
      <HistoryTicksPinEffects
        isPinnedOpen={isPinnedOpen}
        rootRef={rootRef}
        onClose={unpinClose}
      />
    </div>
  );
}

/**
 * Outside-click + Escape to unpin. Kept as a child so hooks run only when
 * the parent actually mounts (drawer returns null with no user messages).
 */
function HistoryTicksPinEffects(props: {
  isPinnedOpen: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}): null {
  const { isPinnedOpen, rootRef, onClose } = props;

  useEffect(() => {
    if (!isPinnedOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      const root = rootRef.current;
      if (!root) return;
      const target = event.target;
      if (target instanceof Node && root.contains(target)) {
        return;
      }
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPinnedOpen, onClose, rootRef]);

  return null;
}
