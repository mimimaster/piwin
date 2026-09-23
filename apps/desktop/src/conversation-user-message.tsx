/**
 * User message renderer for chat thread and conversation view.
 * Handles collapsible overflow, image attachments, copy/revert/intervention actions,
 * and conversation-mode right-aligned layout with light avatar.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { ChatMessageUi } from './chat-reducer';
import { formatTurnExactStamp, formatTurnRelativeAge } from './chat-turn-marginalia.js';
import { MessageAttachments } from './message-attachments';
import { IconCheck, IconClose, IconCopy, IconEdit } from './shell-icons';
import { VoiceHandoverCard } from './voice-handover-card.js';
import { InkstoneMessageIdentity } from './inkstone-message-identity.js';
import { parseSlashMessageDisplay } from './slash/slash-parse.js';
import {
  isUserMessageFooterOverlay,
  measureUnwrappedTextWidth,
  readBubbleInnerWidth,
} from './user-message-footer-layout.js';

export const USER_MESSAGE_COLLAPSE_THRESHOLD = 78;

function pinScrollToStart(node: HTMLElement | null): void {
  if (node && node.scrollTop !== 0) {
    node.scrollTop = 0;
  }
}

function UserMessageAge(props: {
  createdAt?: string;
  locale?: 'zh-CN' | 'en';
}): ReactElement | null {
  const relative = formatTurnRelativeAge(props.createdAt ?? '');
  if (!relative) return null;
  const exact = formatTurnExactStamp(props.createdAt ?? '', props.locale);
  return (
    <span
      className="user-message-time"
      data-testid="user-message-time"
      title={exact || undefined}
    >
      {relative}
    </span>
  );
}

export function UserMessageText(props: { text: string }): ReactElement {
  const parsed = parseSlashMessageDisplay(props.text);
  if (!parsed.isSlash || !parsed.commandName) {
    return <>{props.text}</>;
  }

  return (
    <div className="user-message-slash-container" data-testid="user-message-slash-container">
      <div
        className="user-message-slash-ribbon"
        data-testid="user-message-slash-ribbon"
        style={{
          background: `linear-gradient(90deg, ${parsed.colorVar ?? 'var(--iris, #6b52a1)'} 0%, transparent 60%)`,
        }}
      />
      <div
        className="user-message-slash-header"
        data-testid="user-message-slash-header"
        title={parsed.fullLabel}
      >
        /{parsed.commandName}
      </div>
      {parsed.mainText ? (
        <div className="user-message-slash-content" data-testid="user-message-slash-content">
          {parsed.mainText}
        </div>
      ) : null}
    </div>
  );
}

export type UserMessageContentProps = {
  message: ChatMessageUi;
  streaming?: boolean;
  /** Omit in compact/read-only transcript surfaces that do not own edit state. */
  onRetry?: (messageId: string) => void;
  branchSwitcher?: ReactNode;
  onInterventionEdit?: (messageId: string) => void;
  onInterventionCancel?: (messageId: string) => void | Promise<void>;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
  locale?: 'zh-CN' | 'en';
  isConversationSession?: boolean;
};

function UserMessageForkFoot(props: {
  branchSwitcher: ReactNode;
  locale?: 'zh-CN' | 'en';
}): ReactElement {
  const isChinese = props.locale !== 'en';
  return (
    <div className="ufoot" data-testid="user-message-fork-foot">
      {props.branchSwitcher}
      <span className="ufoot-hint">
        {isChinese
          ? '· 分叉的提问 · 运行中禁用切换 · 双击进入就地编辑'
          : '· forked prompt · switching disabled while running · double-click to edit'}
      </span>
    </div>
  );
}

export function UserMessageContent(props: UserMessageContentProps): ReactElement {
  const { message, isConversationSession } = props;
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isTextOverflow, setIsTextOverflow] = useState(false);
  const [isMultilineFooter, setIsMultilineFooter] = useState(
    () =>
      message.attachments.length > 0 ||
      (message.contextRefs?.length ?? 0) > 0 ||
      message.text.includes('\n') ||
      message.text.length > 48,
  );
  const textRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hasMediaAttachments = message.attachments.length > 0;
  const hasShelfContent = hasMediaAttachments || (message.contextRefs?.length ?? 0) > 0;
  const interventionStatus = message.instructionDelivery?.status;
  const isChinese = props.locale !== 'en';
  // A pending adjustment shows its own edit; edit-and-resend would be a
  // second, disabled pencil beside it.
  const showInterventionEdit =
    interventionStatus === 'pending' && props.onInterventionEdit !== undefined;
  const showRetryEdit = props.onRetry !== undefined && !showInterventionEdit;

  if (message.source === 'voice-delegation') {
    return (
      <VoiceHandoverCard
        message={message}
        {...(props.locale !== undefined ? { locale: props.locale } : {})}
        {...(props.branchSwitcher !== undefined ? { branchSwitcher: props.branchSwitcher } : {})}
        {...(props.onFeedback !== undefined ? { onFeedback: props.onFeedback } : {})}
      />
    );
  }

  const interventionLabel =
    interventionStatus === 'pending'
      ? isChinese
        ? '等待当前步骤完成'
        : 'Waiting for the current step'
      : interventionStatus === 'applying'
        ? isChinese
          ? '正在应用到下一次回复'
          : 'Applying to the next response'
        : interventionStatus === 'applied'
          ? isChinese
            ? '已应用到当前任务'
            : 'Applied to this run'
          : interventionStatus === 'expired'
            ? isChinese
              ? '当前任务已结束，未应用'
              : 'Run ended before it was applied'
            : interventionStatus === 'cancelled'
              ? isChinese
                ? '已取消'
                : 'Cancelled'
              : interventionStatus === 'uncertain'
                ? isChinese
                  ? '是否应用无法确认'
                  : 'Application could not be confirmed'
                : interventionStatus === 'failed'
                  ? isChinese
                    ? '未能应用'
                    : 'Could not be applied'
                  : null;

  // Measure natural height of the text node to determine if it needs collapsing.
  useEffect(() => {
    const textNode = textRef.current;
    const bubble = bodyRef.current;
    if (!textNode && !bubble) return;

    function measure(): void {
      const overflowing = textNode
        ? textNode.scrollHeight > USER_MESSAGE_COLLAPSE_THRESHOLD
        : false;
      setIsTextOverflow(overflowing);
      if (!bubble) {
        setIsMultilineFooter(hasShelfContent || message.text.includes('\n') || overflowing);
        return;
      }
      setIsMultilineFooter(
        isUserMessageFooterOverlay({
          text: message.text,
          hasShelfContent,
          isTextOverflow: overflowing,
          unwrappedTextWidth: textNode ? measureUnwrappedTextWidth(textNode) : 0,
          bubbleInnerWidth: readBubbleInnerWidth(bubble),
        }),
      );
    }

    measure();

    const observer = new ResizeObserver(measure);
    if (textNode) observer.observe(textNode);
    if (bubble) observer.observe(bubble);
    return () => observer.disconnect();
    // The two layouts mount different text/bubble nodes. Without the layout in
    // the deps, switching it keeps observing detached nodes, which measure 0
    // wide and pin a wrapped prompt to the single-line footer column.
  }, [hasShelfContent, message.text, isConversationSession]);

  async function handleCopy(): Promise<void> {
    const payload = message.text.trim();
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      props.onFeedback?.('Copied to clipboard', 'success');
    } catch {
      props.onFeedback?.('Could not copy to clipboard', 'error');
    }
  }

  // Long prompts and media start compact so a history card cannot occupy the
  // transcript viewport. Click (or Enter/Space) expands; selecting text does not.
  const isCollapsible = hasMediaAttachments || isTextOverflow;
  const collapsed = isCollapsible && isCollapsed;

  // overflow:hidden still creates a scrollport. A click in the middle of a
  // long prompt (or scroll anchoring) would otherwise keep that slice visible
  // after collapse. Pin to the first line before paint.
  useLayoutEffect(() => {
    if (!collapsed) return;
    pinScrollToStart(bodyRef.current);
    pinScrollToStart(textRef.current);
  }, [collapsed]);

  const handleToggle = isCollapsible
    ? () => {
        const selection = typeof window !== 'undefined' ? window.getSelection() : null;
        if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
          return;
        }
        setIsCollapsed((previous) => !previous);
      }
    : undefined;

  if (isConversationSession) {
    return (
      <div
        className="user-message-wrapper is-conversation"
        data-testid="user-message-wrapper"
      >
        <div className="user-message-main">
          <InkstoneMessageIdentity message={message} locale={props.locale ?? 'zh-CN'} />
          <div
            ref={bodyRef}
            className={`user-message-bubble user-message-collapsible ${collapsed ? 'is-collapsed' : 'is-expanded'} ${isCollapsible ? 'is-clickable' : ''} ${hasMediaAttachments ? 'has-attachments' : ''} ${isMultilineFooter ? 'is-multiline' : 'is-single-line'}`}
            data-testid="user-message-collapsible-body"
            onClick={handleToggle}
            role={isCollapsible ? 'button' : undefined}
            aria-expanded={isCollapsible ? !collapsed : undefined}
            onKeyDown={
              isCollapsible
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setIsCollapsed((previous) => !previous);
                    }
                  }
                : undefined
            }
          >
            {message.text ? (
              <div ref={textRef} className="user-message-text message-text">
                <UserMessageText text={message.text} />
              </div>
            ) : null}
            <MessageAttachments
              attachments={message.attachments}
              {...(message.contextRefs ? { contextRefs: message.contextRefs } : {})}
              role="user"
              {...(props.locale !== undefined ? { locale: props.locale } : {})}
              cardCollapsed={collapsed}
              onPreviewOpen={() => setIsCollapsed(false)}
            />

            <div
              className="user-message-footer user-message-actions"
              data-testid="user-message-actions"
              onClick={(e) => e.stopPropagation()}
            >
              {interventionLabel ? (
                <span className="user-message-time" data-testid="intervention-delivery-status">
                  {interventionLabel}
                </span>
              ) : null}
              <UserMessageAge
                {...(message.createdAt !== undefined ? { createdAt: message.createdAt } : {})}
                {...(props.locale !== undefined ? { locale: props.locale } : {})}
              />
              <div className="user-message-action-buttons">
                <button
                  type="button"
                  className="user-msg-btn"
                  onClick={() => void handleCopy()}
                  title="Copy"
                  aria-label="Copy message"
                  data-testid="message-copy-btn"
                >
                  {copied ? <IconCheck /> : <IconCopy />}
                </button>
                {interventionStatus === 'pending' && props.onInterventionCancel ? (
                  <button
                    type="button"
                    className="user-msg-btn"
                    onClick={() => void props.onInterventionCancel?.(message.id)}
                    title={isChinese ? '取消这条调整' : 'Cancel this adjustment'}
                    aria-label={isChinese ? '取消这条调整' : 'Cancel this adjustment'}
                    data-testid="intervention-cancel-btn"
                  >
                    <IconClose />
                  </button>
                ) : null}
                {showInterventionEdit ? (
                  <button
                    type="button"
                    className="user-msg-btn"
                    onClick={() => props.onInterventionEdit?.(message.id)}
                    title={isChinese ? '编辑这条调整' : 'Edit this adjustment'}
                    aria-label={isChinese ? '编辑这条调整' : 'Edit this adjustment'}
                    data-testid="intervention-edit-btn"
                  >
                    <IconEdit />
                  </button>
                ) : null}
                {showRetryEdit ? (
                  <button
                    type="button"
                    className="user-msg-btn"
                    onClick={() => props.onRetry?.(message.id)}
                    disabled={
                      props.streaming ||
                      interventionStatus === 'pending' ||
                      interventionStatus === 'applying'
                    }
                    title={isChinese ? '编辑' : 'Edit'}
                    aria-label={isChinese ? '编辑' : 'Edit'}
                    data-testid="message-edit-btn"
                  >
                    <IconEdit />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          {props.branchSwitcher ? (
            <UserMessageForkFoot
              branchSwitcher={props.branchSwitcher}
              {...(props.locale !== undefined ? { locale: props.locale } : {})}
            />
          ) : null}
        </div>

        <div
          className="user-message-avatar"
          data-testid="user-message-avatar"
          aria-hidden="true"
        >
          {isChinese ? '我' : 'You'}
        </div>
      </div>
    );
  }

  // Classic Project / Agent Mode layout: full-width bar, no avatar, trailing actions
  return (
    <div
      className="user-message-wrapper blk"
      data-testid="user-message-wrapper"
    >
      <div
        ref={bodyRef}
        className={`ucard user-message-collapsible ${collapsed ? 'is-collapsed' : 'is-expanded'} ${isCollapsible ? 'is-clickable' : ''} ${hasMediaAttachments ? 'has-attachments' : ''}`}
        data-testid="user-message-collapsible-body"
        onClick={handleToggle}
        role={isCollapsible ? 'button' : undefined}
        aria-expanded={isCollapsible ? !collapsed : undefined}
        onKeyDown={
          isCollapsible
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsCollapsed((previous) => !previous);
                }
              }
            : undefined
        }
      >
        {message.text ? (
          <div ref={textRef} className="message-text">
            <UserMessageText text={message.text} />
          </div>
        ) : null}
        <MessageAttachments
          attachments={message.attachments}
          {...(message.contextRefs ? { contextRefs: message.contextRefs } : {})}
          role="user"
          {...(props.locale !== undefined ? { locale: props.locale } : {})}
          cardCollapsed={collapsed}
          onPreviewOpen={() => setIsCollapsed(false)}
        />
      </div>
      {props.branchSwitcher ? (
        <UserMessageForkFoot
          branchSwitcher={props.branchSwitcher}
          {...(props.locale !== undefined ? { locale: props.locale } : {})}
        />
      ) : null}

      <div
        className="user-message-actions"
        data-testid="user-message-actions"
        onClick={(e) => e.stopPropagation()}
      >
        {interventionLabel ? (
          <span className="user-message-time" data-testid="intervention-delivery-status">
            {interventionLabel}
          </span>
        ) : null}
        <UserMessageAge
          {...(message.createdAt !== undefined ? { createdAt: message.createdAt } : {})}
          {...(props.locale !== undefined ? { locale: props.locale } : {})}
        />
        <button
          type="button"
          className="user-msg-btn"
          onClick={() => void handleCopy()}
          title="Copy"
          aria-label="Copy message"
          data-testid="message-copy-btn"
        >
          {copied ? <IconCheck /> : <IconCopy />}
        </button>
        {interventionStatus === 'pending' && props.onInterventionCancel ? (
          <button
            type="button"
            className="user-msg-btn"
            onClick={() => void props.onInterventionCancel?.(message.id)}
            title={isChinese ? '取消这条调整' : 'Cancel this adjustment'}
            aria-label={isChinese ? '取消这条调整' : 'Cancel this adjustment'}
            data-testid="intervention-cancel-btn"
          >
            <IconClose />
          </button>
        ) : null}
        {showInterventionEdit ? (
          <button
            type="button"
            className="user-msg-btn"
            onClick={() => props.onInterventionEdit?.(message.id)}
            title={isChinese ? '编辑这条调整' : 'Edit this adjustment'}
            aria-label={isChinese ? '编辑这条调整' : 'Edit this adjustment'}
            data-testid="intervention-edit-btn"
          >
            <IconEdit />
          </button>
        ) : null}
        {showRetryEdit ? (
          <button
            type="button"
            className="user-msg-btn"
            onClick={() => props.onRetry?.(message.id)}
            disabled={
              props.streaming ||
              interventionStatus === 'pending' ||
              interventionStatus === 'applying'
            }
            title={isChinese ? '编辑' : 'Edit'}
            aria-label={isChinese ? '编辑' : 'Edit'}
            data-testid="message-edit-btn"
          >
            <IconEdit />
          </button>
        ) : null}
      </div>
    </div>
  );
}
