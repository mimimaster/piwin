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
  // Mantine's item separators use its own grey ramp, off the piwin palette,
  // and the pill already marks the choice (Inkstone .subtab has none).
  withItemsBorders = false,
  ...props
}: SegmentedControlProps): ReactElement {
  const rootClass = className ? `piwin-segmented-control ${className}` : 'piwin-segmented-control';

  return (
    <MantineSegmentedControl
      {...props}
      size={size}
      radius={radius}
      withItemsBorders={withItemsBorders}
      className={rootClass}
      classNames={{
        root: 'piwin-segmented-control',
        indicator: 'piwin-segmented-control-indicator',
        label: 'piwin-segmented-control-label',
      }}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    />
  );
}
