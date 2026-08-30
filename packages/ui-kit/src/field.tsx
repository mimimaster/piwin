import {
  cloneElement,
  isValidElement,
  useId,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

type FieldControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

export type FieldProps = {
  label: ReactNode;
  children: ReactElement<FieldControlProps>;
  description?: string;
  error?: string | null;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  testId?: string;
};

/**
 * Label / description / error association wrapper. Consumer owns the control
 * value and validation; this module only wires accessibility IDs.
 */
export function Field(props: FieldProps): ReactElement {
  const generatedId = useId();
  const requestedControlId = props.htmlFor ?? `field-${generatedId}`;

  if (!isValidElement<FieldControlProps>(props.children)) {
    throw new Error('Field requires exactly one input, select, or textarea control.');
  }

  const controlId = props.children.props.id ?? requestedControlId;
  const descriptionId = props.description ? `${controlId}-description` : undefined;
  const errorId = props.error ? `${controlId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  const existingDescriptionIds = props.children.props['aria-describedby'];
  const mergedDescriptionIds = [existingDescriptionIds, describedBy].filter(Boolean).join(' ');
  const controlAccessibilityProps: FieldControlProps = {
    id: props.children.props.id ?? controlId,
  };

  if (mergedDescriptionIds) {
    controlAccessibilityProps['aria-describedby'] = mergedDescriptionIds;
  }
  if (props.error) {
    controlAccessibilityProps['aria-invalid'] = true;
  } else if (props.children.props['aria-invalid'] !== undefined) {
    controlAccessibilityProps['aria-invalid'] = props.children.props['aria-invalid'];
  }

  const control = cloneElement(props.children, controlAccessibilityProps);

  return (
    <div
      className={props.className ? `ui-field ${props.className}` : 'ui-field'}
      data-testid={props.testId ?? 'field'}
      data-invalid={props.error ? 'true' : 'false'}
    >
      <label className="ui-field-label" htmlFor={controlId}>
        {props.label}
        {props.required ? <span className="ui-field-required"> *</span> : null}
      </label>
      <div className="ui-field-control">{control}</div>
      {props.description ? (
        <p className="ui-field-description muted" id={descriptionId}>
          {props.description}
        </p>
      ) : null}
      {props.error ? (
        <p className="ui-field-error" id={errorId} role="alert">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

export function FieldLabel(props: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}): ReactElement {
  return (
    <label className="ui-field-label" htmlFor={props.htmlFor}>
      {props.children}
      {props.required ? <span className="ui-field-required"> *</span> : null}
    </label>
  );
}

export function FieldDescription(props: {
  id?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <p className="ui-field-description muted" id={props.id}>
      {props.children}
    </p>
  );
}

export function FieldError(props: {
  id?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <p className="ui-field-error" id={props.id} role="alert">
      {props.children}
    </p>
  );
}

export type FieldCheckboxProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
  id?: string;
  /** Accessible name override; defaults to label text. */
  inputAriaLabel?: string;
};

/**
 * Horizontal checkbox + label row for settings toggles.
 * Keeps label association and optional description without stacking like {@link Field}.
 */
export function FieldCheckbox(props: FieldCheckboxProps): ReactElement {
  const generatedId = useId();
  const controlId = props.id ?? `field-checkbox-${generatedId}`;
  const descriptionId = props.description ? `${controlId}-description` : undefined;

  return (
    <div
      className={
        props.className ? `ui-field-checkbox ${props.className}` : 'ui-field-checkbox'
      }
      data-testid="field-checkbox"
      data-disabled={props.disabled ? 'true' : 'false'}
    >
      <input
        id={controlId}
        type="checkbox"
        className="ui-field-checkbox-input"
        checked={props.checked}
        disabled={props.disabled}
        aria-label={props.inputAriaLabel ?? props.label}
        aria-describedby={descriptionId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          props.onCheckedChange(event.currentTarget.checked);
        }}
        {...(props.testId ? { 'data-testid': props.testId } : {})}
      />
      <div className="ui-field-checkbox-body">
        <label className="ui-field-checkbox-label" htmlFor={controlId}>
          {props.label}
        </label>
        {props.description ? (
          <p className="ui-field-description muted" id={descriptionId}>
            {props.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
