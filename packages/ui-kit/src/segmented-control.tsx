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
  ...props
}: SegmentedControlProps): ReactElement {
  const rootClass = className ? `piwin-segmented-control ${className}` : 'piwin-segmented-control';

  return (
    <MantineSegmentedControl
      {...props}
      className={rootClass}
      classNames={{ indicator: 'piwin-segmented-control-indicator' }}
      data-testid={testId}
    />
  );
}
