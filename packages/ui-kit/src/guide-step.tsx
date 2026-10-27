import { Children, type ReactElement, type ReactNode } from 'react';
import { IconCheck } from './icons/action-icons.js';

export type GuideStepState = 'todo' | 'active' | 'done';

export type GuideStepProps = {
  /** 1-based position shown in the marker until the step is done. */
  index: number;
  title: ReactNode;
  /** One line under the title: what this step is, or what it is set to. */
  summary?: ReactNode | undefined;
  /** Small tag after the title, e.g. "Optional". */
  tag?: ReactNode | undefined;
  /** Controls on the right of the heading (a switch, an Edit button). */
  trailing?: ReactNode | undefined;
  state: GuideStepState;
  children?: ReactNode | undefined;
  testId?: string | undefined;
};

/**
 * One numbered step of a guided setup. Done steps keep their summary line and
 * hide their body; the body only renders while it is the step's job to show
 * something. Layout never depends on hover or focus, so rows do not jump.
 */
export function GuideStep(props: GuideStepProps): ReactElement {
  return (
    <section
      className={`piwin-guide-step is-${props.state}`}
      {...(props.testId !== undefined ? { 'data-testid': props.testId } : {})}
    >
      <div className="piwin-guide-step-head">
        <span className="piwin-guide-step-marker" aria-hidden="true">
          {props.state === 'done' ? <IconCheck size={12} stroke={2.4} /> : props.index}
        </span>
        <div className="piwin-guide-step-heading">
          <span className="piwin-guide-step-title">
            {props.title}
            {props.tag !== undefined ? (
              <span className="piwin-guide-step-tag">{props.tag}</span>
            ) : null}
          </span>
          {props.summary !== undefined ? (
            <span className="piwin-guide-step-summary">{props.summary}</span>
          ) : null}
        </div>
        {props.trailing !== undefined ? (
          <div className="piwin-guide-step-trailing">{props.trailing}</div>
        ) : null}
      </div>
      {Children.toArray(props.children).length > 0 ? (
        <div className="piwin-guide-step-body">{props.children}</div>
      ) : null}
    </section>
  );
}
