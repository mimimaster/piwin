import { NumberInput as MantineNumberInput } from '@mantine/core';
import type { NumberInputProps as MantineNumberInputProps } from '@mantine/core';
import type { ReactElement } from 'react';

export type NumberInputProps = MantineNumberInputProps<number> & {
  /** Test id exposed on the root element. */
  testId?: string;
};

/**
 * Piwin-branded numeric input. Reuses TextInput chrome so settings/field
 * rows stay visually consistent; hides native OS steppers by default.
 */
export function NumberInput({
  className,
  testId,
  size = 'sm',
  radius = 'md',
  variant = 'default',
  hideControls = true,
  allowDecimal = false,
  allowNegative = false,
  clampBehavior = 'blur',
  ...props
}: NumberInputProps): ReactElement {
  const rootClass = ['piwin-number-input', 'piwin-text-input', className]
    .filter(Boolean)
    .join(' ');

  return (
    <MantineNumberInput
      {...props}
      size={size}
      radius={radius}
      variant={variant}
      hideControls={hideControls}
      allowDecimal={allowDecimal}
      allowNegative={allowNegative}
      clampBehavior={clampBehavior}
      className={rootClass}
      classNames={{
        input: 'piwin-number-input-field piwin-text-input-field',
        wrapper: 'piwin-number-input-wrapper piwin-text-input-wrapper',
        controls: 'piwin-number-input-controls',
        control: 'piwin-number-input-control',
      }}
      data-testid={testId}
    />
  );
}
