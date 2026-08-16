import { useRef, type ChangeEvent, type ReactElement } from 'react';
import { TextArea, IconPaperclip, IconSendFilled, IconStop } from '@piwin/ui-kit';
import type { MobileMediaAttachment } from '../../hooks/use-mobile-host.js';

export type MobileComposerProps = {
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

export function MobileComposer({
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
}: MobileComposerProps): ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isRunning = activeRunId !== undefined;
  const hasContent = composerText.trim().length > 0 || attachments.length > 0;
  const canSend = hasContent && !isSending && !isUploadingMedia && !disabled;

  return (
    <div className="mobile-composer-dock">
      {/* Attachment previews */}
      {attachments.length > 0 ? (
        <div className="mobile-composer-attachments" aria-label="待发送附件">
          {attachments.map((att) => (
            <span className="mobile-attachment-chip" key={att.id}>
              <span className="mobile-attachment-icon">🖼️</span>
              <span className="mobile-attachment-name">
                {att.name ?? `${att.mimeType.replace('image/', '')} · ${Math.ceil(att.byteSize / 1024)} KB`}
              </span>
              <button
                type="button"
                className="mobile-attachment-remove"
                aria-label="移除附件"
                onClick={() => onRemoveAttachment(att.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {/* Main Composer Row */}
      <div className="mobile-composer-row">
        <button
          type="button"
          className={`mobile-composer-tool-button ${isUploadingMedia ? 'uploading' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending || isUploadingMedia || attachments.length >= 4 || disabled}
          aria-label="添加图片附件"
        >
          <IconPaperclip size={18} />
        </button>
        <input
          ref={fileInputRef}
          className="mobile-file-input"
          type="file"
          accept="image/*"
          onChange={onFileSelected}
        />

        <div className="mobile-composer-input-wrap">
          <TextArea
            value={composerText}
            onChange={setComposerText}
            placeholder="发送消息给 Piwin Host…"
            rows={1}
            maxLength={512_000}
            disabled={isSending || isUploadingMedia || disabled}
            testId="mobile-composer"
          />
        </div>

        {isRunning && onAbort !== undefined ? (
          <button
            type="button"
            className="mobile-composer-action-button abort"
            onClick={onAbort}
            aria-label="停止任务"
          >
            <IconStop size={16} />
          </button>
        ) : (
          <button
            type="button"
            className={`mobile-composer-action-button send ${canSend ? 'active' : ''}`}
            onClick={onSend}
            disabled={!canSend}
            aria-label="发送消息"
          >
            <IconSendFilled size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
