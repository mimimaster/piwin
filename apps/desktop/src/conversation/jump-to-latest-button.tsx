import type { ReactElement } from 'react';
import { IconArrowDown } from '../tool-cards/shell-icons';

const JUMP_TO_LATEST_ICON_PX = 16;
/** Past this the exact number stops mattering to the reader. */
const MAX_BADGE_COUNT = 99;

export type JumpToLatestButtonProps = {
  label: string;
  onClick: () => void;
  testId?: string;
  /** Unseen messages since the reader left the tail; 0 hides the badge. */
  badgeCount?: number;
};

/** Shared jump-to-latest chrome: icon-only circle, never a labeled pill. */
export function JumpToLatestButton(props: JumpToLatestButtonProps): ReactElement {
  const badgeCount = props.badgeCount ?? 0;
  return (
    <button
      type="button"
      className="jump-to-latest-btn"
      data-testid={props.testId ?? 'jump-to-latest-btn'}
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
    >
      <IconArrowDown width={JUMP_TO_LATEST_ICON_PX} height={JUMP_TO_LATEST_ICON_PX} />
      {badgeCount > 0 ? (
        <span className="jump-to-latest-badge" data-testid="jump-to-latest-badge" aria-hidden="true">
          {badgeCount > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : badgeCount}
        </span>
      ) : null}
    </button>
  );
}
