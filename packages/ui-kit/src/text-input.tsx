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
};

export type PasswordInputProps = MantinePasswordInputProps & {
  /** Test id exposed on the root element. */
  testId?: string;
};

/** Piwin-branded text input. Compose with `Field` for labels/hints. */
export function TextInput({ className, testId, ...props }: TextInputProps): ReactElement {
  const rootClass = className ? `piwin-text-input ${className}` : 'piwin-text-input';

  return (
    <MantineTextInput
      {...props}
      className={rootClass}
      classNames={{ input: 'piwin-text-input-field' }}
      data-testid={testId}
    />
  );
}

/** Piwin-branded password input. */
export function PasswordInput({
  className,
  testId,
  ...props
}: PasswordInputProps): ReactElement {
  const rootClass = className ? `piwin-password-input ${className}` : 'piwin-password-input';

  return (
    <MantinePasswordInput
      {...props}
      className={rootClass}
      classNames={{ innerInput: 'piwin-password-input-field' }}
      data-testid={testId}
    />
  );
}
