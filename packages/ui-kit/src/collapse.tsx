import { Collapse as MantineCollapse } from '@mantine/core';
import type { CollapseProps as MantineCollapseProps } from '@mantine/core';
import type { ReactElement } from 'react';

export type CollapseProps = MantineCollapseProps & {
  /** Test id exposed on the root element. */
  testId?: string;
};

/** Animated collapse/expand wrapper. Keeps children in the DOM while collapsed
 * so form state is preserved; `display-none` mode avoids React Activity
 * layout thrash that can jitter sibling rows on toggle. */
export function Collapse({
  className,
  testId,
  keepMounted = true,
  keepMountedMode = 'display-none',
  animateOpacity = true,
  transitionDuration = 200,
  ...props
}: CollapseProps): ReactElement {
  const rootClass = className ? `piwin-collapse ${className}` : 'piwin-collapse';

  return (
    <MantineCollapse
      {...props}
      className={rootClass}
      keepMounted={keepMounted}
      keepMountedMode={keepMountedMode}
      animateOpacity={animateOpacity}
      transitionDuration={transitionDuration}
      data-testid={testId}
    />
  );
}
