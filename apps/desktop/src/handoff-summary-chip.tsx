/**
 * The handoff chip opens the stored summary. The text is model output:
 * shown as plain text, never parsed as HTML or Markdown.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Popover } from '@piwin/ui-kit';
import { IconClose, IconDocument } from './shell-icons';
import { useDesktopLocale } from './desktop-locale-context';

export type HandoffSummaryPreview =
  | { ok: true; summary: string; truncated: boolean }
  | { ok: false; message: string };

export type HandoffSummaryChipProps = {
  label: string;
  meta: string;
  sessionId: string;
  onLoad: (sessionId: string) => Promise<HandoffSummaryPreview>;
  onRemove?: (() => void) | undefined;
  shelfId?: string | undefined;
};

export function HandoffSummaryChip(props: HandoffSummaryChipProps): ReactElement {
  const { locale } = useDesktopLocale();
  const zh = locale === 'zh-CN';
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<HandoffSummaryPreview | 'loading' | 'idle'>('idle');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview('loading');
    void props.onLoad(props.sessionId).then((result) => {
      if (!cancelled) setPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, props.onLoad, props.sessionId]);

  const previewLabel = zh ? '交接摘要' : 'Handoff summary';
  return (
    <div
      className="ref composer-v2-attachment-chip composer-v2-doc-comment-chip composer-v2-context-chip"
      data-testid="composer-context-chip"
      data-context-kind="session-handoff"
      data-shelf-chip=""
      data-shelf-kind="context-ref"
      {...(props.shelfId ? { 'data-shelf-id': props.shelfId } : {})}
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="start"
        label={previewLabel}
        testId="handoff-summary-preview"
        contentClassName="handoff-summary-preview"
        trigger={
          <button
            type="button"
            className="handoff-summary-chip-open"
            data-testid="handoff-summary-preview-trigger"
            aria-label={zh ? `查看${previewLabel}` : `View ${previewLabel}`}
          >
            <span className="doc-comment-chip-icon" aria-hidden>
              <IconDocument width={14} height={14} />
            </span>
            <span className="chip-text">{props.label}</span>
            <span className="doc-comment-chip-dot" aria-hidden>
              ·
            </span>
            <span className="doc-comment-chip-count">{props.meta}</span>
          </button>
        }
      >
        <HandoffSummaryBody preview={preview} zh={zh} />
      </Popover>
      {props.onRemove ? (
        <button
          type="button"
          className="composer-v2-chip-remove doc-comment-chip-remove"
          data-testid="composer-context-chip-remove"
          tabIndex={-1}
          onClick={props.onRemove}
          aria-label={zh ? `移除${props.label}` : `Remove ${props.label}`}
        >
          <IconClose width={12} height={12} />
        </button>
      ) : null}
    </div>
  );
}

function HandoffSummaryBody(props: {
  preview: HandoffSummaryPreview | 'loading' | 'idle';
  zh: boolean;
}): ReactElement {
  if (props.preview === 'loading' || props.preview === 'idle') {
    return <p className="handoff-summary-preview-status">{props.zh ? '正在读取…' : 'Loading…'}</p>;
  }
  if (!props.preview.ok) {
    return <p className="handoff-summary-preview-status">{props.preview.message}</p>;
  }
  return (
    <>
      <pre className="handoff-summary-preview-text" data-testid="handoff-summary-preview-text">
        {props.preview.summary}
      </pre>
      {props.preview.truncated ? (
        <p className="handoff-summary-preview-status">
          {props.zh
            ? '摘要超过可携带的长度，这里和发送时用的是同一段截断后的文本。'
            : 'The summary is longer than the carried limit. This is the same truncated text the next prompt receives.'}
        </p>
      ) : null}
    </>
  );
}
