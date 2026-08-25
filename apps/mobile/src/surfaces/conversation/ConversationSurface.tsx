import { useRef, type ChangeEvent, type ReactElement } from 'react';
import type { RemoteSessionSummary } from '@piwin/contracts';
import { Button, Card, IconCheck, IconClose, Notice } from '@piwin/ui-kit';
import { MobileMessageItem } from '../../components/chat/MobileMessageItem.js';
import { ModernComposer } from '../../components/chat/ModernComposer.js';
import { MobileQuickPrompts } from '../../components/chat/MobileQuickPrompts.js';
import { useComposerStackHeight } from '../../hooks/use-composer-stack-height.js';
import { useFollowTail } from '../../hooks/use-follow-tail.js';
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
  onQueueAndSend?: (() => void) | undefined;
  onDismissBusy?: (() => void) | undefined;
  mutationsEnabled?: boolean | undefined;
  onSpeechError?: ((message: string) => void) | undefined;
  htmlUiModeEnabled: boolean;
  healthEnabled?: boolean;
  includeAppleHealth?: boolean;
  onToggleAppleHealth?: () => void;
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
  onQueueAndSend,
  onDismissBusy,
  mutationsEnabled = true,
  onSpeechError,
  htmlUiModeEnabled,
  healthEnabled = false,
  includeAppleHealth = false,
  onToggleAppleHealth,
}: ConversationSurfaceProps): ReactElement {
  const streamRef = useRef<HTMLDivElement | null>(null);
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const lastMessage = messages[messages.length - 1];
  const followRevision = `${messages.length}:${lastMessage?.id ?? ''}:${lastMessage?.text.length ?? 0}:${lastMessage?.status ?? ''}`;

  useFollowTail({ axisRef: streamRef, revision: followRevision });
  useComposerStackHeight({ dockRef: composerDockRef, streamRef });

  if (!activeSessionId) {
    return (
      <div className="modern-conversation-canvas empty">
        <Card className="mobile-slice-card mobile-empty-session-card" withBorder>
          <div className="mobile-empty-session-icon" aria-hidden="true">
            💬
          </div>
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
      <div ref={streamRef} className="modern-chat-stream-area">
        {messages.length === 0 ? (
          <MobileQuickPrompts
            onSelectPrompt={(text) => setComposerText(text)}
            projectName={projectName}
          />
        ) : (
          messages.map((message) => (
            <MobileMessageItem
              key={message.id}
              message={message}
              htmlUiModeEnabled={htmlUiModeEnabled}
            />
          ))
        )}

        {errorMessage !== undefined ? (
          <Notice
            tone="error"
            title={pendingReplaceRunId !== undefined ? '发送失败' : '操作失败'}
            testId="mobile-chat-error"
            action={
              pendingReplaceRunId !== undefined ? (
                <span className="mobile-busy-actions">
                  {onQueueAndSend !== undefined ? (
                    <Button variant="secondary" size="compact" onClick={onQueueAndSend}>
                      排队发送
                    </Button>
                  ) : null}
                  {onReplaceAndSend !== undefined ? (
                    <Button variant="secondary" size="compact" onClick={onReplaceAndSend}>
                      中断并发送
                    </Button>
                  ) : null}
                  {onDismissBusy !== undefined ? (
                    <Button variant="ghost" size="compact" onClick={onDismissBusy}>
                      取消
                    </Button>
                  ) : null}
                </span>
              ) : null
            }
          >
            {errorMessage}
          </Notice>
        ) : null}

        {permissionRequest ? (
          <div className="modern-permission-banner">
            <div className="permission-banner-header">
              <span className="permission-tag">权限审批</span>
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
      </div>

      <div ref={composerDockRef} className="modern-composer-dock">
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
          disabled={!mutationsEnabled}
          healthEnabled={healthEnabled}
          includeAppleHealth={includeAppleHealth}
          {...(onToggleAppleHealth === undefined ? {} : { onToggleAppleHealth })}
        />
      </div>
    </div>
  );
}
