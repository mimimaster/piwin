import type { ReactElement, ReactNode, SVGProps } from 'react';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'stroke'> & {
  size?: number | string | undefined;
  stroke?: number | string | undefined;
};

export function createIcon(
  children: ReactNode,
  grid: 16 | 24 = 24,
): (props: IconProps) => ReactElement {
  return function ShellIcon(props: IconProps): ReactElement {
    const {
      className = '',
      children: overrideChildren,
      size,
      stroke,
      strokeWidth,
      width,
      height,
      ...rest
    } = props;
    const computedStrokeWidth = typeof stroke === 'number' ? stroke : (strokeWidth ?? 1.6);
    const computedStroke = typeof stroke === 'string' ? stroke : 'currentColor';
    const computedWidth = size ?? width ?? '1em';
    const computedHeight = size ?? height ?? '1em';

    return (
      <svg
        viewBox={`0 0 ${grid} ${grid}`}
        width={computedWidth}
        height={computedHeight}
        fill="none"
        stroke={computedStroke}
        strokeWidth={computedStrokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`tabler-icon ${className}`.trim()}
        {...rest}
      >
        {overrideChildren ?? children}
      </svg>
    );
  };
}
