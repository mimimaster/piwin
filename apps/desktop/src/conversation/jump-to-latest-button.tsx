import type { ReactElement, ReactNode } from 'react';
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
  /** Same chrome for a sibling viewport control (return to reading point). */
  icon?: ReactNode;
  className?: string;
};

/** Shared jump-to-latest chrome: icon-only circle, never a labeled pill. */
export function JumpToLatestButton(props: JumpToLatestButtonProps): ReactElement {
  const badgeCount = props.badgeCount ?? 0;
  return (
    <button
      type="button"
      className={props.className ? `jump-to-latest-btn ${props.className}` : 'jump-to-latest-btn'}
      data-testid={props.testId ?? 'jump-to-latest-btn'}
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
    >
      {props.icon ?? (
        <IconArrowDown width={JUMP_TO_LATEST_ICON_PX} height={JUMP_TO_LATEST_ICON_PX} />
      )}
      {badgeCount > 0 ? (
        <span className="jump-to-latest-badge" data-testid="jump-to-latest-badge" aria-hidden="true">
          {badgeCount > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : badgeCount}
        </span>
      ) : null}
    </button>
  );
}

export const JUMP_TO_LATEST_BUTTON_ICON_PX = JUMP_TO_LATEST_ICON_PX;
