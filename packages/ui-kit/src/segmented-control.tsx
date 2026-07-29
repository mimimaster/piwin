import { SegmentedControl as MantineSegmentedControl } from '@mantine/core';
import type { SegmentedControlProps as MantineSegmentedControlProps } from '@mantine/core';
import type { ReactElement } from 'react';

export type SegmentedControlProps = MantineSegmentedControlProps & {
  /** Test id exposed on the root element. */
  testId?: string;
};

/** Piwin-branded segmented control for mutually exclusive small choices. */
export function SegmentedControl({
  className,
  testId,
  size = 'sm',
  radius = 'md',
  ...props
}: SegmentedControlProps): ReactElement {
  const rootClass = className ? `piwin-segmented-control ${className}` : 'piwin-segmented-control';

  return (
    <MantineSegmentedControl
      {...props}
      size={size}
      radius={radius}
      className={rootClass}
      classNames={{
        root: 'piwin-segmented-control',
        indicator: 'piwin-segmented-control-indicator',
        label: 'piwin-segmented-control-label',
      }}
      data-testid={testId}
    />
  );
}
