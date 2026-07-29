/**
 * Floating side-tool picker for the right panel.
 */

import { type ReactElement } from 'react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  IconButton,
} from '@piwin/ui-kit';
import { IconPlus } from './shell-icons';
import type { DesktopLocale } from './desktop-locale';
import { SECTION_META, sectionLabel, type RightPanelTab } from './right-panel-sections';

export type RightPanelPlusMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: DesktopLocale;
  openTabs: RightPanelTab[];
  onSelect: (tab: RightPanelTab) => void;
  active?: boolean;
};

export function RightPanelPlusMenu(props: RightPanelPlusMenuProps): ReactElement {
  const label = props.locale === 'zh-CN' ? '打开面板' : 'Open panel';

  const trigger = (
    <IconButton
      className={props.open || props.active ? 'right-panel-tab-add active' : 'right-panel-tab-add'}
      label={label}
      data-testid="right-panel-tab-add"
      aria-pressed={props.open}
    >
      <IconPlus />
    </IconButton>
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
      {SECTION_META.map((tab) => {
        const labelText = sectionLabel(tab.id, props.locale);
        const alreadyOpen = props.openTabs.includes(tab.id);
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
            {alreadyOpen ? (
              <span className="right-panel-plus-hint muted">
                {props.locale === 'zh-CN' ? '已打开' : 'Open'}
              </span>
            ) : null}
          </DropdownMenuItem>
        );
      })}
    </DropdownMenu>
  );
}
