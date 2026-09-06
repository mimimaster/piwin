/**
 * ‹ n/m › control on a forked user turn (ADR 0055).
 * Clicks switch to the adjacent sibling head; Host refuses while a run is live.
 */
import { IconButton } from '@piwin/ui-kit';
import type { TranscriptBranchPoint } from '@piwin/contracts';
import type { ReactElement } from 'react';
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
  const previousHead = adjacentSiblingHead(point, -1);
  const nextHead = adjacentSiblingHead(point, 1);
  const label = formatBranchSwitcherLabel(point);
  return (
    <div className="bsw message-branch-switcher" data-testid="message-branch-switcher">
      <IconButton
        label={isChinese ? '上一个分支' : 'Previous branch'}
        className="message-branch-switcher-btn"
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
      <span className="message-branch-switcher-label" data-testid="message-branch-label">
        {label}
      </span>
      <IconButton
        label={isChinese ? '下一个分支' : 'Next branch'}
        className="message-branch-switcher-btn"
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
