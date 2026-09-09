/**
 * Presentational slash autocomplete popover for the composer.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { groupSlashItems } from './slash-match';
import { isReservedSlashExecuteName } from './slash-parse';
import type { SlashItem } from './slash-types';
import { useDesktopLocale } from '../desktop-locale-context';

const GROUP_LABEL_ZH: Record<string, string> = {
  Command: '命令',
  Mode: '模式',
  Skill: '技能',
};

function localizeGroupLabel(label: string, isZh: boolean): string {
  if (!isZh) return label;
  return GROUP_LABEL_ZH[label] ?? label;
}

export type SlashMenuProps = {
  open: boolean;
  items: SlashItem[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onApply: (item: SlashItem) => void;
  onClose: () => void;
};

export function SlashMenu(props: SlashMenuProps): ReactElement | null {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
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
          <div className="slash-menu-empty muted">{isZh ? '没有匹配项' : 'No matches'}</div>
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
            <div className="slash-menu-section-title muted">
              {localizeGroupLabel(section.groupLabel, isZh)}
            </div>
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
                  className={selected ? 'slash-menu-item active' : 'slash-menu-item'}
                  disabled={!item.available && !isReservedSlashExecuteName(item.name)}
                  title={item.unavailableReason ?? item.description}
                  ref={selected ? selectedRef : undefined}
                  onMouseEnter={() => props.onSelectIndex(index)}
                  onClick={() => {
                    if (!item.available && !isReservedSlashExecuteName(item.name)) {
                      return;
                    }
                    props.onApply(item);
                  }}
                >
                  <span className="slash-menu-name">/{item.name}</span>
                  <span className="slash-menu-label">{item.label}</span>
                  <span className="slash-menu-badge muted">
                    {localizeGroupLabel(item.groupLabel, isZh)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
