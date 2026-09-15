import type { ReactElement } from 'react';
import { IconArrowDown } from './shell-icons';

const JUMP_TO_LATEST_ICON_PX = 16;

export type JumpToLatestButtonProps = {
  label: string;
  onClick: () => void;
  testId?: string;
};

/** Shared jump-to-latest chrome: icon-only circle, never a labeled pill. */
export function JumpToLatestButton(props: JumpToLatestButtonProps): ReactElement {
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
    </button>
  );
}
