import { Card as MantineCard } from '@mantine/core';
import type { CardProps as MantineCardProps } from '@mantine/core';
import type { ReactElement, ReactNode } from 'react';

export type CardProps = MantineCardProps & {
  /** Test id exposed on the root element. */
  testId?: string;
  children: ReactNode;
};

/** Piwin-branded surface card for list items and grouped settings. */
export function Card({ className, testId, children, ...props }: CardProps): ReactElement {
  const rootClass = className ? `piwin-card ${className}` : 'piwin-card';

  return (
    <MantineCard {...props} className={rootClass} data-testid={testId}>
      {children}
    </MantineCard>
  );
}
