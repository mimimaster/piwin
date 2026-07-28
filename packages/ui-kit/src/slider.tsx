import { Slider as MantineSlider } from '@mantine/core';
import type { SliderProps as MantineSliderProps } from '@mantine/core';
import type { ReactElement } from 'react';

export type SliderProps = MantineSliderProps & {
  /** Test id exposed on the root element. */
  testId?: string;
};

/** Piwin-branded single-value slider. */
export function Slider({ className, testId, ...props }: SliderProps): ReactElement {
  const rootClass = className ? `piwin-slider ${className}` : 'piwin-slider';

  return (
    <MantineSlider
      {...props}
      className={rootClass}
      classNames={{
        track: 'piwin-slider-track',
        bar: 'piwin-slider-bar',
        thumb: 'piwin-slider-thumb',
      }}
      data-testid={testId}
    />
  );
}
