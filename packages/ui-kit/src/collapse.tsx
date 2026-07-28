import { Collapse as MantineCollapse } from '@mantine/core';
import type { CollapseProps as MantineCollapseProps } from '@mantine/core';
import type { ReactElement } from 'react';

export type CollapseProps = MantineCollapseProps & {
  /** Test id exposed on the root element. */
  testId?: string;
};

/** Animated collapse/expand wrapper. Keeps children in the DOM while collapsed
 * so state and layout do not jump. */
export function Collapse({
  className,
  testId,
  ...props
}: CollapseProps): ReactElement {
  const rootClass = className ? `piwin-collapse ${className}` : 'piwin-collapse';

  return (
    <MantineCollapse
      {...props}
      className={rootClass}
      keepMounted
      animateOpacity
      transitionDuration={200}
      data-testid={testId}
    />
  );
}
