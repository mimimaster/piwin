import { NativeSelect as MantineNativeSelect } from '@mantine/core';
import type { NativeSelectProps as MantineNativeSelectProps } from '@mantine/core';
import type { ReactElement } from 'react';

export type SelectProps = MantineNativeSelectProps & {
  /** Test id exposed on the root element. */
  testId?: string;
};

/**
 * Piwin-branded select for short option lists (language, source, etc.).
 * Uses Mantine NativeSelect so layout stays in-flow and does not open a
 * portal (avoids settings-page scroll / focus jitter).
 */
export function Select({
  className,
  testId,
  size = 'sm',
  radius = 'md',
  ...props
}: SelectProps): ReactElement {
  const rootClass = className ? `piwin-select ${className}` : 'piwin-select';

  return (
    <MantineNativeSelect
      {...props}
      size={size}
      radius={radius}
      className={rootClass}
      classNames={{
        input: 'piwin-select-field',
        wrapper: 'piwin-select-wrapper',
      }}
      data-testid={testId}
    />
  );
}
