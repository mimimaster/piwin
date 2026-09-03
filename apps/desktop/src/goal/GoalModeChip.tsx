/**
 * GoalModeChip — the only standing indicator that the composer is in Goal mode.
 *
 * Goal is entered through `/goal` (or `/goal <objective>`), never through a
 * picker, so the toolbar needs no mode control at rest. Once Goal is armed the
 * user still has to be able to see it and back out before the first send —
 * `GoalStickyStrip` only appears after a turn exists. This chip fills that gap:
 * it renders only while Goal is active and its one action is to leave.
 */
import type { ReactElement } from 'react';
import { IconClose } from '../shell-icons';
import { useDesktopLocale } from '../desktop-locale-context';

export type GoalModeChipProps = {
  disabled: boolean;
  onExit: () => void;
};

export function GoalModeChip({ disabled, onExit }: GoalModeChipProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  return (
    <button
      type="button"
      className="composer-goal-chip"
      data-testid="composer-goal-chip"
      disabled={disabled}
      title={isZh ? 'Goal 模式已开启 — 点击退出，回到 Agent' : 'Goal mode is on — click to return to Agent'}
      aria-label={isZh ? '退出 Goal 模式' : 'Exit Goal mode'}
      onClick={onExit}
    >
      <span className="composer-goal-chip-label">Goal</span>
      <IconClose className="composer-goal-chip-exit" aria-hidden />
    </button>
  );
}