import { Textarea as MantineTextarea } from '@mantine/core';
import {
  useId,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type TextareaHTMLAttributes,
} from 'react';

/**
 * Props for {@link TextArea}. Consumers keep a value-first `onChange` so
 * existing call sites do not have to unwrap a DOM event.
 */
export type TextAreaProps = {
  /** Visible label above the control. */
  label?: string;
  /** Helper text rendered below the control. */
  description?: string;
  /** Test id exposed on the root element. */
  testId?: string;
  /** Placeholder forwarded to the textarea. */
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
  /** Visible rows for the field. */
  rows?: number;
  /** Optional id; generated when omitted so the label associates correctly. */
  id?: string;
  /** Optional className merged onto the root wrapper. */
  className?: string;
  /** Association id injected by {@link Field}. */
  'aria-describedby'?: string;
  /** Invalid flag injected by {@link Field}. */
  'aria-invalid'?: boolean;
  /** Pass-through native attributes (spellcheck, autocomplete, name, ...). */
  nativeProps?: Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'value' | 'onChange' | 'placeholder' | 'disabled' | 'maxLength' | 'rows' | 'id'
  >;
};

/**
 * Piwin-branded textarea. Mantine `Textarea` for chrome;
 * public props stay the existing value-first contract.
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
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: TextAreaProps): ReactElement {
  const generatedId = useId();
  const controlId = id ?? `textarea-${generatedId}`;
  const invalid = Boolean(error) || ariaInvalid === true;

  const rootClass = [
    'piwin-text-area',
    disabled ? 'piwin-text-area--disabled' : null,
    invalid ? 'piwin-text-area--error' : null,
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
      data-invalid={invalid ? 'true' : 'false'}
    >
      <MantineTextarea
        {...(nativeProps as ComponentPropsWithoutRef<typeof MantineTextarea>)}
        id={controlId}
        classNames={{
          label: 'piwin-text-area-label',
          input: 'piwin-text-area-field',
          wrapper: 'piwin-text-area-wrapper',
          description: 'piwin-text-area-description',
          error: 'piwin-text-area-error',
        }}
        label={label}
        description={description}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        error={error ?? undefined}
        errorProps={{ role: 'alert' }}
        value={value}
        onChange={handleChange}
        rows={rows ?? 3}
        resize="none"
        size="sm"
        radius="md"
        variant="default"
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid ? true : undefined}
      />
      {maxLength ? (
        <p className="piwin-text-area-counter muted">
          {value.length}/{maxLength}
        </p>
      ) : null}
    </div>
  );
}
