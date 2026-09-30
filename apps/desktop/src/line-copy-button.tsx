import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useDesktopContextMenu } from './context-menu';
import { useDesktopLocale } from './desktop-locale-context';
import { IconCheck, IconCopy } from './shell-icons';
import { elementToMarkdown } from './selection-markdown';

const COPIED_FLASH_MS = 1200;

/**
 * Hover affordance next to the comment button: copies the surrounding rendered
 * line/block as Markdown source. Reads the DOM at click time, so it needs no
 * props from the Markdown renderer.
 */
export function LineCopyButton(): ReactElement {
  const { locale } = useDesktopLocale();
  const desktopMenu = useDesktopContextMenu();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const label = locale === 'zh-CN' ? '复制此块' : 'Copy block';

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <button
      type="button"
      className="line-copy-btn"
      title={label}
      aria-label={label}
      data-copied={copied ? 'true' : undefined}
      onClick={(event) => {
        event.stopPropagation();
        const wrapper = event.currentTarget.closest('.enhanced-line-wrapper');
        const markdown = wrapper ? elementToMarkdown(wrapper) : '';
        if (!markdown) return;
        if (desktopMenu) {
          desktopMenu.dispatchers.copyText(markdown);
        } else {
          navigator.clipboard.writeText(markdown).catch((error: unknown) => {
            console.warn('[piwin] copy block failed', error);
          });
        }
        setCopied(true);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
      }}
    >
      {copied ? <IconCheck width={13} height={13} /> : <IconCopy width={13} height={13} />}
    </button>
  );
}
