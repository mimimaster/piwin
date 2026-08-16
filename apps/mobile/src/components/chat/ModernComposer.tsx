import { useRef, type ChangeEvent, type ReactElement } from 'react';
import { IconPaperclip, IconArrowUp, IconStop, IconMic } from '@piwin/ui-kit';
import { useSpeechRecognition } from '../../hooks/use-speech-recognition.js';
import { MobileQuickActionsBar } from './MobileQuickActionsBar.js';
import type { MobileMediaAttachment } from '../../hooks/use-mobile-host.js';

export type ModernComposerProps = {
  composerText: string;
  setComposerText: (text: string) => void;
  attachments: MobileMediaAttachment[];
  onRemoveAttachment: (id: string) => void;
  onFileSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onSend: () => void;
  onAbort?: (() => void) | undefined;
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
  isSending,
  isUploadingMedia,
  activeRunId,
  disabled = false,
}: ModernComposerProps): ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isRunning = activeRunId !== undefined;
  const hasContent = composerText.trim().length > 0 || attachments.length > 0;
  const canSend = hasContent && !isSending && !isUploadingMedia && !disabled;

  const speech = useSpeechRecognition({
    onTranscript: (transcript) => {
      setComposerText(transcript);
    },
  });

  const handleSelectQuickAction = (prompt: string) => {
    setComposerText(prompt);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        if (speech.isListening) {
          speech.stopListening();
        }
        onSend();
      }
    }
  };

  const handleSendClick = () => {
    if (speech.isListening) {
      speech.stopListening();
    }
    onSend();
  };

  return (
    <div className="modern-composer-wrapper">
      {/* 1. Quick Actions Toolbar (visible when composer is empty) */}
      {!isRunning && !isSending && composerText.length === 0 ? (
        <MobileQuickActionsBar onSelectAction={handleSelectQuickAction} />
      ) : null}

      {/* 2. Attachment thumbnail chips above composer */}
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

      {/* 2. Floating Capsule Composer */}
      <div className="modern-composer-capsule">
        {/* Attachment Upload Button */}
        <button
          type="button"
          className="modern-composer-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending || isUploadingMedia || attachments.length >= 4 || disabled}
          aria-label="选择图片附件"
        >
          <IconPaperclip size={18} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="modern-file-input-hidden"
          onChange={onFileSelected}
        />

        {/* Input Textarea */}
        <textarea
          ref={textareaRef}
          className="modern-composer-textarea"
          value={composerText}
          onChange={(e) => setComposerText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={speech.isListening ? '正在聆听您的语音…' : '发送消息给 Piwin…'}
          rows={1}
          disabled={isSending || isUploadingMedia || disabled}
        />

        {/* Action Button: Stop, Listening, Send or Mic */}
        {isRunning && onAbort !== undefined ? (
          <button
            type="button"
            className="modern-composer-action-btn stop-active"
            onClick={onAbort}
            aria-label="停止任务"
          >
            <IconStop size={14} />
          </button>
        ) : speech.isListening ? (
          <button
            type="button"
            className="modern-composer-action-btn mic-listening"
            onClick={speech.stopListening}
            aria-label="停止语音识别"
          >
            <IconMic size={16} />
          </button>
        ) : hasContent ? (
          <button
            type="button"
            className={`modern-composer-action-btn ${canSend ? 'send-active' : 'send-disabled'}`}
            onClick={handleSendClick}
            disabled={!canSend}
            aria-label="发送消息"
          >
            <IconArrowUp size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="modern-composer-action-btn mic-idle"
            onClick={speech.startListening}
            disabled={isSending || isUploadingMedia || disabled}
            aria-label="开始语音输入 (iOS Speech API)"
          >
            <IconMic size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
