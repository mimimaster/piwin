/**
 * User message renderer for chat thread and conversation view.
 * Handles collapsible overflow, image attachments, copy/revert/intervention actions,
 * and conversation-mode right-aligned layout with light avatar.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { ChatMessageUi } from './chat-reducer';
import { formatMessageTime } from './conversation-message-identity';
import { MessageAttachments } from './message-attachments';
import { IconCheck, IconClose, IconCopy, IconEdit, IconRevert } from './shell-icons';

export const USER_MESSAGE_COLLAPSE_THRESHOLD = 78;

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

export function UserMessageContent(props: UserMessageContentProps): ReactElement {
  const { message, isConversationSession } = props;
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isTextOverflow, setIsTextOverflow] = useState(false);
  const textRef = useRef<HTMLDivElement | null>(null);
  const formattedTime = formatMessageTime(message.createdAt);
  const hasMediaAttachments = message.attachments.length > 0;
  const hasContextRefs = Boolean(message.contextRefs && message.contextRefs.length > 0);
  const interventionStatus = message.instructionDelivery?.status;
  const isChinese = props.locale !== 'en';

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
    const node = textRef.current;
    if (!node) return;

    function measure(): void {
      if (!node) return;
      const naturalHeight = node.scrollHeight;
      setIsTextOverflow(naturalHeight > USER_MESSAGE_COLLAPSE_THRESHOLD);
    }

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [message.text]);

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

  // Attachments in Agent mode start compact to avoid crowding.
  // In Conversation Chat mode, messages always display naturally without collapsing.
  const isCollapsible = !isConversationSession && (hasMediaAttachments || isTextOverflow);
  const collapsed = isCollapsible && isCollapsed;

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
          <div
            className={`user-message-bubble user-message-collapsible ${collapsed ? 'is-collapsed' : 'is-expanded'} ${isCollapsible ? 'is-clickable' : ''} ${hasMediaAttachments ? 'has-attachments' : ''}`}
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
            {hasContextRefs && message.contextRefs ? (
              <div className="user-message-quote-box" data-testid="user-message-quote-box">
                <MessageAttachments
                  attachments={[]}
                  contextRefs={message.contextRefs}
                  role="user"
                  {...(props.locale !== undefined ? { locale: props.locale } : {})}
                />
              </div>
            ) : null}
            <MessageAttachments
              attachments={message.attachments}
              role="user"
              {...(props.locale !== undefined ? { locale: props.locale } : {})}
            />
            {message.text ? (
              <div ref={textRef} className="user-message-text message-text">
                {message.text}
              </div>
            ) : null}

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
                {interventionStatus === 'pending' && props.onInterventionEdit ? (
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
                {props.onRetry ? (
                  <button
                    type="button"
                    className="user-msg-btn"
                    onClick={() => props.onRetry?.(message.id)}
                    disabled={
                      props.streaming ||
                      interventionStatus === 'pending' ||
                      interventionStatus === 'applying'
                    }
                    title={isChinese ? '编辑此轮' : 'Edit this turn'}
                    aria-label={isChinese ? '编辑此轮' : 'Edit this turn'}
                    data-testid="message-revert-btn"
                  >
                    <IconRevert />
                  </button>
                ) : null}
              </div>
              {props.branchSwitcher}
              {formattedTime ? (
                <span className="user-message-time" data-testid="user-message-time">
                  {formattedTime}
                </span>
              ) : null}
            </div>
          </div>
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
      className="user-message-wrapper"
      data-testid="user-message-wrapper"
    >
      <div
        className={`user-message-collapsible ${collapsed ? 'is-collapsed' : 'is-expanded'} ${isCollapsible ? 'is-clickable' : ''} ${hasMediaAttachments ? 'has-attachments' : ''}`}
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
        <MessageAttachments
          attachments={message.attachments}
          {...(message.contextRefs ? { contextRefs: message.contextRefs } : {})}
          role="user"
          {...(props.locale !== undefined ? { locale: props.locale } : {})}
        />
        {message.text ? (
          <div ref={textRef} className="message-text">
            {message.text}
          </div>
        ) : null}
      </div>

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
        {formattedTime ? (
          <span className="user-message-time" data-testid="user-message-time">
            {formattedTime}
          </span>
        ) : null}
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
        {interventionStatus === 'pending' && props.onInterventionEdit ? (
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
        {props.onRetry ? (
          <button
            type="button"
            className="user-msg-btn"
            onClick={() => props.onRetry?.(message.id)}
            disabled={
              props.streaming ||
              interventionStatus === 'pending' ||
              interventionStatus === 'applying'
            }
            title={isChinese ? '编辑此轮' : 'Edit this turn'}
            aria-label={isChinese ? '编辑此轮' : 'Edit this turn'}
            data-testid="message-revert-btn"
          >
            <IconRevert />
          </button>
        ) : null}
        {props.branchSwitcher}
      </div>
    </div>
  );
}
