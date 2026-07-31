/**
 * Presentational `@` mention autocomplete popover for the composer.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { groupAtItems } from './at-match';
import type { AtItem } from './at-types';

export type AtMenuProps = {
  open: boolean;
  items: AtItem[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onApply: (item: AtItem) => void;
  onClose: () => void;
};

export function AtMenu(props: AtMenuProps): ReactElement | null {
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

  const sections = groupAtItems(props.items);
  if (sections.length === 0) {
    return (
      <div
        className="at-menu-root"
        ref={rootRef}
        data-testid="composer-at-menu"
        role="listbox"
        aria-label="At mentions"
      >
        <div className="at-menu">
          <div className="at-menu-empty muted">No context matches</div>
        </div>
      </div>
    );
  }

  let flatIndex = -1;

  return (
    <div
      className="at-menu-root"
      ref={rootRef}
      data-testid="composer-at-menu"
      role="listbox"
      aria-label="At mentions"
    >
      <div className="at-menu">
        {sections.map((section) => (
          <div key={section.groupLabel} className="at-menu-section">
            <div className="at-menu-section-title muted">{section.groupLabel}</div>
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
                  data-testid={`at-item-${item.id}`}
                  className={selected ? 'at-menu-item active' : 'at-menu-item'}
                  ref={selected ? selectedRef : undefined}
                  onMouseEnter={() => props.onSelectIndex(index)}
                  onClick={() => props.onApply(item)}
                >
                  <div className="at-menu-item-row">
                    <span className="at-menu-item-name">{item.label}</span>
                    {item.badge ? <span className="at-menu-item-badge">{item.badge}</span> : null}
                  </div>
                  <div className="at-menu-item-desc muted">{item.description}</div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
