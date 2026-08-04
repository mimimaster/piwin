import type { ChangeEvent, InputHTMLAttributes, ReactElement } from 'react';

export type ColorInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> & {
  /** Test id exposed on the visible text field. */
  testId?: string;
  /** Emits the normalized value from either the swatch or hex field. */
  onValueChange?: (value: string) => void;
};

/** Compact swatch + hex field used by theme editors. */
export function ColorInput({
  className,
  testId,
  value,
  onValueChange,
  ...props
}: ColorInputProps): ReactElement {
  const currentValue = typeof value === 'string' ? value : '#000000';
  const rootClass = className ? `piwin-color-input ${className}` : 'piwin-color-input';

  function handleSwatchChange(event: ChangeEvent<HTMLInputElement>): void {
    onValueChange?.(event.currentTarget.value.toUpperCase());
  }

  function handleTextChange(event: ChangeEvent<HTMLInputElement>): void {
    onValueChange?.(event.currentTarget.value.toUpperCase());
  }

  return (
    <div className={rootClass}>
      <input
        {...props}
        type="color"
        className="piwin-color-input-swatch"
        value={currentValue}
        onChange={handleSwatchChange}
        aria-label={props['aria-label']}
      />
      <input
        type="text"
        className="piwin-color-input-field"
        value={currentValue}
        onChange={handleTextChange}
        spellCheck={false}
        inputMode="text"
        data-testid={testId}
        aria-label={props['aria-label']}
      />
    </div>
  );
}
