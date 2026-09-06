/**
 * ‹ n/m › control on a forked turn (ADR 0055).
 * ‹ › switch adjacent sibling heads; the label expands that fork's list.
 * Host refuses a switch while a run is live.
 */
import { useState, type ReactElement } from 'react';
import { IconButton, Popover } from '@piwin/ui-kit';
import type { TranscriptBranchPoint } from '@piwin/contracts';
import { BranchPointsPanel } from './branch-points-panel.js';
import {
  adjacentSiblingHead,
  formatBranchSwitcherLabel,
} from './conversation-branch.js';

export type MessageBranchSwitcherProps = {
  point: TranscriptBranchPoint;
  disabled?: boolean;
  onSwitch: (headMessageId: string) => void;
  locale?: 'zh-CN' | 'en';
};

export function MessageBranchSwitcher(props: MessageBranchSwitcherProps): ReactElement {
  const { point, disabled = false, onSwitch, locale } = props;
  const isChinese = locale !== 'en';
  const panelLocale = locale === 'en' ? 'en' : 'zh-CN';
  const previousHead = adjacentSiblingHead(point, -1);
  const nextHead = adjacentSiblingHead(point, 1);
  const label = formatBranchSwitcherLabel(point);
  const [open, setOpen] = useState(false);
  const openLabel = isChinese ? '打开此处分叉' : 'Open branches at this turn';

  return (
    <div className="bsw message-branch-switcher" data-testid="message-branch-switcher">
      <IconButton
        label={isChinese ? '上一个分支' : 'Previous branch'}
        className="message-branch-switcher-btn"
        size={18}
        disabled={disabled || previousHead === undefined}
        data-testid="message-branch-prev"
        onClick={() => {
          if (previousHead !== undefined) {
            onSwitch(previousHead);
          }
        }}
      >
        ‹
      </IconButton>
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="start"
        side="bottom"
        label={openLabel}
        testId="message-branch-tree-popover"
        contentClassName="session-lineage-popover message-branch-tree-popover"
        trigger={
          <button
            type="button"
            className="message-branch-switcher-label"
            title={openLabel}
            aria-label={openLabel}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="message-branch-label"
          >
            {label}
          </button>
        }
      >
        <BranchPointsPanel
          branchPoints={[point]}
          disabled={disabled}
          onSwitch={(headMessageId) => {
            onSwitch(headMessageId);
            setOpen(false);
          }}
          locale={panelLocale}
        />
      </Popover>
      <IconButton
        label={isChinese ? '下一个分支' : 'Next branch'}
        className="message-branch-switcher-btn"
        size={18}
        disabled={disabled || nextHead === undefined}
        data-testid="message-branch-next"
        onClick={() => {
          if (nextHead !== undefined) {
            onSwitch(nextHead);
          }
        }}
      >
        ›
      </IconButton>
    </div>
  );
}
