/**
 * Floating side-tool picker for the right panel.
 *
 * Every entry opens another instance. Already-open tools stay selectable,
 * so two Browsers can sit next to each other the way two terminals do.
 */

import { type ReactElement } from 'react';
import { DropdownMenu, DropdownMenuItem, DropdownMenuLabel } from '@piwin/ui-kit';
import { IconPlus } from './shell-icons';
import type { DesktopLocale } from './desktop-locale';
import {
  SECTION_META,
  isPlusMenuSection,
  sectionLabel,
  type RightPanelTab,
  type RightPanelToolKind,
} from './right-panel-sections';

export type RightPanelPlusMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: DesktopLocale;
  onSelect: (kind: RightPanelToolKind) => void;
  active?: boolean;
};

export function RightPanelPlusMenu(props: RightPanelPlusMenuProps): ReactElement {
  const label = props.locale === 'zh-CN' ? '打开面板' : 'Open panel';

  // Plain text-style trigger (no IconButton / ActionIcon chip background).
  const trigger = (
    <button
      type="button"
      className={
        props.open || props.active
          ? 'right-panel-tab-add insp-plus active'
          : 'right-panel-tab-add insp-plus'
      }
      aria-label={label}
      title={label}
      data-testid="right-panel-tab-add"
      aria-pressed={props.open}
    >
      <IconPlus />
    </button>
  );

  return (
    <DropdownMenu
      open={props.open}
      onOpenChange={props.onOpenChange}
      side="bottom"
      align="start"
      label={props.locale === 'zh-CN' ? '打开面板' : 'Open side panel'}
      testId="right-panel-plus-menu"
      contentClassName="right-panel-plus-menu"
      trigger={trigger}
    >
      <DropdownMenuLabel className="right-panel-plus-caption muted">
        {props.locale === 'zh-CN' ? '打开' : 'Open'}
      </DropdownMenuLabel>
      {SECTION_META.filter(isPlusMenuSection).map((tab) => {
        const labelText = sectionLabel(tab.id, props.locale);
        return (
          <DropdownMenuItem
            key={tab.id}
            onSelect={() => props.onSelect(tab.id)}
            testId={`right-panel-plus-${tab.id}`}
          >
            <span className="right-panel-plus-icon" aria-hidden>
              {tab.icon}
            </span>
            <span className="right-panel-plus-label">{labelText}</span>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenu>
  );
}

export type { RightPanelTab };
