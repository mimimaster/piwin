/**
 * Composer / chat chip for a picked web element (ADR 0020 §6).
 *
 * Unlike {@link MediaPreview} (image-specific: resolves a media path to a
 * thumbnail), a web-element attachment carries a URL + CSS selector + bounded
 * text — no `path` field. This chip renders that metadata compactly, with an
 * optional screenshot thumbnail when the host cropped one.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { WebElementAttachmentRef } from '@piwin/contracts';
import { resolveMediaPreviewUrl } from './media-utils';

const MAX_CHIP_TEXT_CHARS = 60;

function truncateText(value: string): string {
  if (value.length <= MAX_CHIP_TEXT_CHARS) return value;
  return `${value.slice(0, MAX_CHIP_TEXT_CHARS)}…`;
}

export function WebElementChip(props: {
  attachment: WebElementAttachmentRef;
  compact?: boolean;
}): ReactElement {
  const { attachment, compact } = props;
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  // Resolve the optional element-cropped screenshot to a displayable URL.
  useEffect(() => {
    if (!attachment.screenshotPath) {
      setThumbUrl(null);
      return;
    }
    let cancelled = false;
    void resolveMediaPreviewUrl(attachment.screenshotPath).then((resolved) => {
      if (!cancelled) {
        setThumbUrl(resolved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.screenshotPath]);

  return (
    <div
      className={compact ? 'web-element-chip compact' : 'web-element-chip'}
      data-testid="web-element-chip"
      title={attachment.url}
    >
      {thumbUrl ? (
        <img className="web-element-chip-thumb" src={thumbUrl} alt={attachment.selector} />
      ) : null}
      <div className="web-element-chip-meta">
        <span className="web-element-chip-url">{shortenUrl(attachment.url)}</span>
        <span className="web-element-chip-selector">{attachment.selector}</span>
        {attachment.text ? (
          <span className="web-element-chip-text">{truncateText(attachment.text)}</span>
        ) : null}
      </div>
    </div>
  );
}

function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.host}${path}${parsed.search}`;
  } catch {
    return url;
  }
}
