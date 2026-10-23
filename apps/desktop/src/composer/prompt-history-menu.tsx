/**
 * Popover listing the last N composer prompts (ArrowUp history).
 */
import { useEffect, useRef, type ReactElement } from 'react';

export type PromptHistoryMenuProps = {
  open: boolean;
  items: readonly string[];
  selectedIndex: number;
  title: string;
  emptyLabel: string;
  onSelectIndex: (index: number) => void;
  onApply: (text: string) => void;
  onClose: () => void;
};

function clipPreview(text: string, max = 96): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max - 1)}…`;
}

export function PromptHistoryMenu(props: PromptHistoryMenuProps): ReactElement | null {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        props.onClose();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [props]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [props.selectedIndex, props.open]);

  if (!props.open) {
    return null;
  }

  return (
    <div
      className="slash-menu-root prompt-history-menu-root"
      ref={rootRef}
      data-testid="composer-prompt-history-menu"
      role="listbox"
      aria-label={props.title}
    >
      <div className="slash-menu prompt-history-menu">
        <div className="slash-menu-section-title muted">{props.title}</div>
        {props.items.length === 0 ? (
          <div className="slash-menu-empty muted">{props.emptyLabel}</div>
        ) : (
          props.items.map((text, index) => {
            const selected = index === props.selectedIndex;
            return (
              <button
                key={`${index}:${text.slice(0, 24)}`}
                type="button"
                ref={selected ? selectedRef : undefined}
                className={selected ? 'slash-menu-item active' : 'slash-menu-item'}
                role="option"
                aria-selected={selected}
                data-testid={`composer-prompt-history-item-${index}`}
                onMouseEnter={() => props.onSelectIndex(index)}
                onClick={() => props.onApply(text)}
              >
                <span className="slash-menu-name muted">{index + 1}</span>
                <span className="slash-menu-label" title={text}>
                  {clipPreview(text)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
