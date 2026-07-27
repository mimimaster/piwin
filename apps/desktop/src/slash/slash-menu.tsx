/**
 * Presentational slash autocomplete popover for the composer.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { groupSlashItems } from './slash-match';
import type { SlashItem } from './slash-types';

export type SlashMenuProps = {
  open: boolean;
  items: SlashItem[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onApply: (item: SlashItem) => void;
  onClose: () => void;
};

export function SlashMenu(props: SlashMenuProps): ReactElement | null {
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

  const sections = groupSlashItems(props.items);
  if (sections.length === 0) {
    return (
      <div
        className="slash-menu-root"
        ref={rootRef}
        data-testid="composer-slash-menu"
        role="listbox"
        aria-label="Slash commands"
      >
        <div className="slash-menu">
          <div className="slash-menu-empty muted">No matches</div>
        </div>
      </div>
    );
  }

  let flatIndex = -1;

  return (
    <div
      className="slash-menu-root"
      ref={rootRef}
      data-testid="composer-slash-menu"
      role="listbox"
      aria-label="Slash commands"
    >
      <div className="slash-menu">
        {sections.map((section) => (
          <div key={section.groupLabel} className="slash-menu-section">
            <div className="slash-menu-section-title muted">{section.groupLabel}</div>
            {section.items.map((item) => {
              flatIndex += 1;
              const index = flatIndex;
              const selected = index === props.selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-testid={`slash-item-${item.id}`}
                  data-slash-id={item.id}
                  className={
                    selected
                      ? 'slash-menu-item active'
                      : 'slash-menu-item'
                  }
                  disabled={!item.available}
                  title={item.unavailableReason ?? item.description}
                  ref={selected ? selectedRef : undefined}
                  onMouseEnter={() => props.onSelectIndex(index)}
                  onClick={() => {
                    if (!item.available) {
                      return;
                    }
                    props.onApply(item);
                  }}
                >
                  <span className="slash-menu-name">/{item.name}</span>
                  <span className="slash-menu-label">{item.label}</span>
                  <span className="slash-menu-badge muted">{item.groupLabel}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
