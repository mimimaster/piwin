import type { HTMLAttributes, ReactElement } from 'react';

export type SurfaceTone = 'base' | 'raised' | 'inset' | 'selected';

export type SurfaceProps = HTMLAttributes<HTMLDivElement> & {
  tone?: SurfaceTone;
};

/** A bounded semantic surface; consumers own layout while ui-kit owns chrome. */
export function Surface({
  tone = 'base',
  className,
  ...elementProps
}: SurfaceProps): ReactElement {
  const rootClassName = ['piwin-surface', `piwin-surface--${tone}`, className]
    .filter(Boolean)
    .join(' ');
  return <div {...elementProps} className={rootClassName} />;
}
