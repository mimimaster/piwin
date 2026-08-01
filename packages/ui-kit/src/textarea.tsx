import {
  useId,
  type ChangeEvent,
  type ReactElement,
  type TextareaHTMLAttributes,
} from 'react';

/**
 * Props for {@link TextArea}. Extends the native textarea attributes that make
 * sense for a controlled field; consumers always own `value` and `onChange`.
 */
export type TextAreaProps = {
  /** Visible label above the control. */
  label?: string;
  /** Helper text rendered below the control. */
  description?: string;
  /** Test id exposed on the root element. */
  testId?: string;
  /** Placeholder forwarded to the native textarea. */
  placeholder?: string;
  /** Disables the control and dims the wrapper. */
  disabled?: boolean;
  /** Max character count; when set, a `value.length / maxLength` counter renders. */
  maxLength?: number;
  /** Error message rendered below the control; also sets `aria-invalid`. */
  error?: string | null;
  /** Controlled value. */
  value: string;
  /** Controlled change handler. */
  onChange: (value: string, event: ChangeEvent<HTMLTextAreaElement>) => void;
  /** Optional rows hint for the native textarea. */
  rows?: number;
  /** Optional id; generated when omitted so the label associates correctly. */
  id?: string;
  /** Optional className merged onto the root wrapper. */
  className?: string;
  /** Pass-through native attributes (spellcheck, autocomplete, name, ...). */
  nativeProps?: Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'value' | 'onChange' | 'placeholder' | 'disabled' | 'maxLength' | 'rows' | 'id'
  >;
};

/**
 * Piwin-branded textarea. Thin wrapper over the native `<textarea>` element —
 * no Mantine dependency. Composes label / description / error inline so callers
 * do not need a separate `Field` wrapper for the common case.
 */
export function TextArea({
  label,
  description,
  testId,
  placeholder,
  disabled = false,
  maxLength,
  error,
  value,
  onChange,
  rows,
  id,
  className,
  nativeProps,
}: TextAreaProps): ReactElement {
  const generatedId = useId();
  const controlId = id ?? `textarea-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy =
    [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  const rootClass = [
    'piwin-text-area',
    disabled ? 'piwin-text-area--disabled' : null,
    error ? 'piwin-text-area--error' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    onChange(event.currentTarget.value, event);
  }

  return (
    <div
      className={rootClass}
      data-testid={testId}
      data-disabled={disabled ? 'true' : 'false'}
      data-invalid={error ? 'true' : 'false'}
    >
      {label ? (
        <label className="piwin-text-area-label" htmlFor={controlId}>
          {label}
        </label>
      ) : null}
      <textarea
        {...nativeProps}
        id={controlId}
        className="piwin-text-area-field"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        maxLength={maxLength}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
      />
      {description ? (
        <p className="piwin-text-area-description muted" id={descriptionId}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p className="piwin-text-area-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
      {maxLength ? (
        <p className="piwin-text-area-counter muted">
          {value.length}/{maxLength}
        </p>
      ) : null}
    </div>
  );
}
