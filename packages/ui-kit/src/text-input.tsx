import {
  TextInput as MantineTextInput,
  PasswordInput as MantinePasswordInput,
} from '@mantine/core';
import type {
  TextInputProps as MantineTextInputProps,
  PasswordInputProps as MantinePasswordInputProps,
} from '@mantine/core';
import type { ReactElement } from 'react';

export type TextInputProps = MantineTextInputProps & {
  /** Test id exposed on the root element. */
  testId?: string;
  /**
   * Compact toolbar layout (search / filter rows). Drops label stack spacing
   * expectations and pairs with adjacent compact buttons.
   */
  toolbar?: boolean;
};

export type PasswordInputProps = MantinePasswordInputProps & {
  /** Test id exposed on the root element. */
  testId?: string;
};

/** Piwin-branded text input. Compose with `Field` for labels/hints. */
export function TextInput({
  className,
  testId,
  toolbar = false,
  size = 'sm',
  radius = 'md',
  variant = 'default',
  ...props
}: TextInputProps): ReactElement {
  const rootClass = [
    'piwin-text-input',
    toolbar ? 'piwin-text-input--toolbar' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <MantineTextInput
      {...props}
      size={size}
      radius={radius}
      variant={variant}
      className={rootClass}
      classNames={{
        input: 'piwin-text-input-field',
        wrapper: 'piwin-text-input-wrapper',
      }}
      data-testid={testId}
    />
  );
}

/** Piwin-branded password input. */
export function PasswordInput({
  className,
  testId,
  size = 'sm',
  radius = 'md',
  variant = 'default',
  ...props
}: PasswordInputProps): ReactElement {
  const rootClass = className ? `piwin-password-input ${className}` : 'piwin-password-input';

  return (
    <MantinePasswordInput
      {...props}
      size={size}
      radius={radius}
      variant={variant}
      className={rootClass}
      classNames={{
        input: 'piwin-password-input-shell',
        innerInput: 'piwin-password-input-field',
        wrapper: 'piwin-password-input-wrapper',
      }}
      data-testid={testId}
    />
  );
}
