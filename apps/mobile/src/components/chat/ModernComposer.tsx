import { useRef, type ChangeEvent, type ReactElement } from 'react';
import { IconPaperclip, IconArrowUp, IconStop, IconMic, IconImage } from '@piwin/ui-kit';
import { HoldToTalkOverlay } from './HoldToTalkOverlay.js';
import { MobileQuickActionsBar } from './MobileQuickActionsBar.js';
import { useHoldToTalk } from '../../use-hold-to-talk.js';
import type { MobileMediaAttachment } from '../../hooks/use-mobile-host.js';

export type ModernComposerProps = {
  composerText: string;
  setComposerText: (text: string) => void;
  attachments: MobileMediaAttachment[];
  onRemoveAttachment: (id: string) => void;
  onFileSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onSend: (text?: string) => void;
  healthEnabled?: boolean;
  includeAppleHealth?: boolean;
  onToggleAppleHealth?: () => void;
  onAbort?: (() => void) | undefined;
  onSpeechError?: ((message: string) => void) | undefined;
  isSending: boolean;
  isUploadingMedia: boolean;
  activeRunId?: string | undefined;
  disabled?: boolean | undefined;
};

export function ModernComposer({
  composerText,
  setComposerText,
  attachments,
  onRemoveAttachment,
  onFileSelected,
  onSend,
  onAbort,
  onSpeechError,
  isSending,
  isUploadingMedia,
  activeRunId,
  disabled = false,
  healthEnabled = false,
  includeAppleHealth = false,
  onToggleAppleHealth,
}: ModernComposerProps): ReactElement {
  const albumInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isRunning = activeRunId !== undefined;
  const hasContent = composerText.trim().length > 0 || attachments.length > 0;
  const canSend = hasContent && !isSending && !isUploadingMedia && !disabled;
  const holdEnabled =
    !hasContent && !isSending && !isUploadingMedia && !disabled && !isRunning;

  const hold = useHoldToTalk({
    enabled: holdEnabled,
    onSend: (text) => onSend(text),
    ...(onSpeechError === undefined ? {} : { onError: onSpeechError }),
  });

  const handleSelectQuickAction = (prompt: string) => {
    setComposerText(prompt);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  };

  const attachDisabled = isSending || isUploadingMedia || attachments.length >= 4 || disabled;

  return (
    <div className="modern-composer-wrapper">
      {!isRunning && !isSending && composerText.length === 0 ? (
        <MobileQuickActionsBar onSelectAction={handleSelectQuickAction} />
      ) : null}

      {attachments.length > 0 ? (
        <div className="modern-composer-attachment-bar">
          {attachments.map((att) => (
            <div className="modern-attachment-thumb" key={att.id}>
              <span className="modern-attachment-icon">🖼️</span>
              <span className="modern-attachment-name">
                {att.name ?? `${Math.ceil(att.byteSize / 1024)}KB`}
              </span>
              <button
                type="button"
                className="modern-attachment-del"
                onClick={() => onRemoveAttachment(att.id)}
                aria-label="删除附件"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <HoldToTalkOverlay
        phase={hold.phase}
        liveTranscript={hold.liveTranscript}
        cancelling={hold.cancelling}
        hint={hold.hint}
      />

      <div className="modern-composer-capsule">
        <button
          type="button"
          className="modern-composer-attach-btn"
          onClick={() => albumInputRef.current?.click()}
          disabled={attachDisabled}
          aria-label="从相册选择图片"
        >
          <IconPaperclip size={18} />
        </button>
        <button
          type="button"
          className="modern-composer-attach-btn"
          onClick={() => cameraInputRef.current?.click()}
          disabled={attachDisabled}
          aria-label="拍照上传"
          data-testid="mobile-camera-button"
        >
          <IconImage size={18} />
        </button>
        <input
          ref={albumInputRef}
          type="file"
          accept="image/*"
          className="modern-file-input-hidden"
          onChange={onFileSelected}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="modern-file-input-hidden"
          data-testid="mobile-camera-input"
          onChange={onFileSelected}
        />

        {healthEnabled ? (
          <button
            type="button"
            className={`modern-composer-health-chip${includeAppleHealth ? ' is-active' : ''}`}
            data-testid="mobile-health-chip"
            aria-pressed={includeAppleHealth}
            onClick={onToggleAppleHealth}
          >
            @Health
          </button>
        ) : null}

        <textarea
          ref={textareaRef}
          className="modern-composer-textarea"
          value={composerText}
          onChange={(event) => setComposerText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={hold.phase === 'listening' ? '正在聆听…' : '发消息或按住说话…'}
          rows={1}
          disabled={isSending || isUploadingMedia || disabled || hold.phase !== 'idle'}
        />

        {isRunning && onAbort !== undefined ? (
          <button
            type="button"
            className="modern-composer-action-btn stop-active"
            onClick={onAbort}
            aria-label="停止任务"
          >
            <IconStop size={14} />
          </button>
        ) : null}
        {hasContent ? (
          <button
            type="button"
            className={`modern-composer-action-btn ${canSend ? 'send-active' : 'send-disabled'}`}
            onClick={() => onSend()}
            disabled={!canSend}
            aria-label="发送消息"
          >
            <IconArrowUp size={16} />
          </button>
        ) : !isRunning && hold.supported ? (
          <button
            type="button"
            className={`modern-composer-action-btn mic-idle${hold.phase === 'listening' ? ' mic-listening' : ''}`}
            disabled={!holdEnabled}
            aria-label="按住说话"
            data-testid="mobile-hold-mic"
            {...hold.micPointer}
          >
            <IconMic size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
