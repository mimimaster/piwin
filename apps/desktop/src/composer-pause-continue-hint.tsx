import type { ReactElement } from 'react';

export function ComposerPauseContinueHint(props: {
  hint: string;
  actionLabel: string;
  onResumeCheckpoint: () => void;
}): ReactElement {
  return (
    <div className="composer-pause-continue-hint" data-testid="composer-pause-continue-hint">
      <span className="composer-pause-continue-hint-copy">{props.hint}</span>
      <button
        type="button"
        className="composer-pause-continue-hint-action"
        data-testid="composer-pause-continue-hint-resume"
        onClick={props.onResumeCheckpoint}
      >
        {props.actionLabel}
      </button>
    </div>
  );
}
