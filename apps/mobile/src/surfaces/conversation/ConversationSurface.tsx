import { useEffect, useRef, type ChangeEvent, type ReactElement } from 'react';
import type { RemoteSessionSummary } from '@piwin/contracts';
import { Button, Card, IconCheck, IconClose, Notice } from '@piwin/ui-kit';
import { MobileMessageItem } from '../../components/chat/MobileMessageItem.js';
import { ModernComposer } from '../../components/chat/ModernComposer.js';
import { MobileQuickPrompts } from '../../components/chat/MobileQuickPrompts.js';
import type {
  MobileMediaAttachment,
  MobileTranscriptMessage,
  RemotePermissionRequest,
} from '../../hooks/use-mobile-host.js';

export type ConversationSurfaceProps = {
  activeSessionId?: string | undefined;
  sessions: RemoteSessionSummary[];
  messages: MobileTranscriptMessage[];
  composerText: string;
  setComposerText: (text: string) => void;
  attachments: MobileMediaAttachment[];
  onRemoveAttachment: (id: string) => void;
  onFileSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onSend: (text?: string) => void;
  onAbort: () => void;
  isSending: boolean;
  isUploadingMedia: boolean;
  activeRunId?: string | undefined;
  permissionRequest?: RemotePermissionRequest | undefined;
  isResolvingPermission: boolean;
  onResolvePermission: (decision: 'allow' | 'deny') => void;
  onNavigateToSessions: () => void;
  projectName?: string | undefined;
  errorMessage?: string | undefined;
  pendingReplaceRunId?: string | undefined;
  onReplaceAndSend?: (() => void) | undefined;
  onSpeechError?: ((message: string) => void) | undefined;
};

export function ConversationSurface({
  activeSessionId,
  sessions,
  messages,
  composerText,
  setComposerText,
  attachments,
  onRemoveAttachment,
  onFileSelected,
  onSend,
  onAbort,
  isSending,
  isUploadingMedia,
  activeRunId,
  permissionRequest,
  isResolvingPermission,
  onResolvePermission,
  onNavigateToSessions,
  projectName,
  errorMessage,
  pendingReplaceRunId,
  onReplaceAndSend,
  onSpeechError,
}: ConversationSurfaceProps): ReactElement {
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.text]);

  const dismissKeyboard = () => {
    if (
      document.activeElement instanceof HTMLElement &&
      (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT')
    ) {
      document.activeElement.blur();
    }
  };

  if (!activeSessionId) {
    return (
      <div className="modern-conversation-canvas empty" onClick={dismissKeyboard}>
        <Card className="mobile-slice-card mobile-empty-session-card" withBorder>
          <div className="mobile-empty-session-icon">💬</div>
          <h3>未选择活跃会话</h3>
          <p>请从侧边栏挑选一个历史会话，或点击右上角新建会话开始对话。</p>
          <Button variant="primary" onClick={onNavigateToSessions}>
            打开历史会话 ({sessions.length})
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="modern-conversation-canvas">
      {/* 1. Chat Message Stream */}
      <div
        className="modern-chat-stream-area"
        onPointerDown={dismissKeyboard}
        onScroll={dismissKeyboard}
        onClick={dismissKeyboard}
      >
        {messages.length === 0 ? (
          <MobileQuickPrompts
            onSelectPrompt={(text) => setComposerText(text)}
            projectName={projectName}
          />
        ) : (
          messages.map((message) => (
            <MobileMessageItem key={message.id} message={message} />
          ))
        )}

        {/* Pending Permission Decision Gate */}
        {errorMessage !== undefined ? (
          <Notice
            tone="error"
            title={pendingReplaceRunId !== undefined ? '发送失败' : '操作失败'}
            testId="mobile-chat-error"
            action={
              pendingReplaceRunId !== undefined && onReplaceAndSend !== undefined ? (
                <Button variant="secondary" size="compact" onClick={onReplaceAndSend}>
                  中断并发送
                </Button>
              ) : null
            }
          >
            {errorMessage}
          </Notice>
        ) : null}

        {permissionRequest ? (
          <div className="modern-permission-banner">
            <div className="permission-banner-header">
              <span className="permission-tag">⚠️ 权限审批</span>
              <code className="permission-action-code">{permissionRequest.action}</code>
            </div>
            {permissionRequest.detail ? (
              <p className="permission-detail-text">{permissionRequest.detail}</p>
            ) : null}
            <div className="permission-btn-group">
              <Button
                variant="danger"
                size="compact"
                disabled={isResolvingPermission}
                onClick={() => onResolvePermission('deny')}
              >
                <IconClose size={13} />
                拒绝
              </Button>
              <Button
                variant="primary"
                size="compact"
                disabled={isResolvingPermission}
                onClick={() => onResolvePermission('allow')}
              >
                <IconCheck size={13} />
                允许执行
              </Button>
            </div>
          </div>
        ) : null}

        <div ref={scrollEndRef} className="modern-scroll-anchor" />
      </div>

      {/* 2. ChatGPT-Style Modern Capsule Composer */}
      <ModernComposer
        composerText={composerText}
        setComposerText={setComposerText}
        attachments={attachments}
        onRemoveAttachment={onRemoveAttachment}
        onFileSelected={onFileSelected}
        onSend={onSend}
        onAbort={onAbort}
        onSpeechError={onSpeechError}
        isSending={isSending}
        isUploadingMedia={isUploadingMedia}
        activeRunId={activeRunId}
      />
    </div>
  );
}
