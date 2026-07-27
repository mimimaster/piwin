import type { ReactElement } from 'react';

export type SpinnerProps = {
  label?: string;
  testId?: string;
};

/** Minimal CSS spinner; host styles `.ui-spinner`. */
export function Spinner(props: SpinnerProps): ReactElement {
  return (
    <span
      className="ui-spinner"
      role="status"
      aria-label={props.label ?? 'Loading'}
      data-testid={props.testId ?? 'spinner'}
    />
  );
}
