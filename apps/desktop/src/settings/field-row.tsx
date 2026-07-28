/**
 * Settings field row template: label + hint on the left, control on the right.
 * Inspired by modern clean settings layouts (e.g. Cursor).
 */
import { useId, type ReactElement, type ReactNode } from 'react';

export type FieldRowProps = {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
  testId?: string;
};

export function FieldRow(props: FieldRowProps): ReactElement {
  const generatedId = useId();
  const controlId = `field-row-${generatedId}`;

  return (
    <div
      className={props.className ? `ui-field-row ${props.className}` : 'ui-field-row'}
      data-testid={props.testId ?? 'field-row'}
    >
      <div className="ui-field-row-content">
        <label className="ui-field-row-label" htmlFor={controlId}>
          {props.label}
        </label>
        {props.description ? (
          <p className="ui-field-row-description">
            {props.description}
          </p>
        ) : null}
      </div>
      <div className="ui-field-row-control">
        {props.children}
      </div>
    </div>
  );
}
