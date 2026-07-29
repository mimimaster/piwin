import { Switch as MantineSwitch } from '@mantine/core';
import type { SwitchProps as MantineSwitchProps } from '@mantine/core';
import type { ChangeEvent, ReactElement } from 'react';

export type SwitchProps = MantineSwitchProps & {
  /** Test id exposed on the root element. */
  testId?: string;
  /** Simplified toggle handler when the change event is not needed. */
  onCheckedChange?: (checked: boolean) => void;
};

/** Piwin-branded switch. Use inside `FieldRow` for labelled toggles or with
 * `aria-label` for standalone list-row controls. Fixed track size — do not
 * put conditional text next to it without reserved width (causes row jitter). */
export function Switch({
  className,
  testId,
  onChange,
  onCheckedChange,
  size = 'sm',
  withThumbIndicator = false,
  ...props
}: SwitchProps): ReactElement {
  const rootClass = className ? `piwin-switch ${className}` : 'piwin-switch';

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onCheckedChange?.(event.currentTarget.checked);
    onChange?.(event);
  }

  return (
    <MantineSwitch
      {...props}
      size={size}
      withThumbIndicator={withThumbIndicator}
      className={rootClass}
      classNames={{
        root: 'piwin-switch-root',
        input: 'piwin-switch-input',
        track: 'piwin-switch-track',
        thumb: 'piwin-switch-thumb',
        label: 'piwin-switch-label',
      }}
      onChange={handleChange}
      data-testid={testId}
    />
  );
}
