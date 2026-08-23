import type { ButtonHTMLAttributes, ReactElement } from 'react';
import { IconPause } from '../shell-icons';

function IconPlay(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9.5 7.2v9.6c0 .62.67 1.01 1.22.7l7.4-4.28c.55-.32.55-1.08 0-1.4l-7.4-4.28c-.55-.31-1.22.08-1.22.7Z" />
    </svg>
  );
}

type GoalRunControlProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> & {
  label: string;
};

export function GoalPauseButton({
  className,
  label,
  ...buttonProps
}: GoalRunControlProps): ReactElement {
  return (
    <button
      type="button"
      className={['goal-run-control', 'goal-run-control--pause', className].filter(Boolean).join(' ')}
      data-testid="goal-pause-btn"
      {...buttonProps}
    >
      <span className="goal-run-control__icon" aria-hidden>
        <IconPause />
      </span>
      <span className="goal-run-control__label">{label}</span>
    </button>
  );
}

export function GoalResumeButton({
  className,
  label,
  ...buttonProps
}: GoalRunControlProps): ReactElement {
  return (
    <button
      type="button"
      className={['goal-run-control', 'goal-run-control--resume', className].filter(Boolean).join(' ')}
      data-testid="goal-resume-btn"
      {...buttonProps}
    >
      <span className="goal-run-control__icon" aria-hidden>
        <IconPlay />
      </span>
      <span className="goal-run-control__label">{label}</span>
    </button>
  );
}
