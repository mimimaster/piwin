import { ActionIcon } from '@mantine/core';
import type {
  ButtonHTMLAttributes,
  ComponentPropsWithoutRef,
  ReactElement,
} from 'react';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  label: string;
  /** Mantine ActionIcon size. Default md; compact chrome (Live bar) passes pixels. */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;
};

/** Secondary visual actions always provide an accessible label and tooltip. */
export function IconButton({
  label,
  className,
  title,
  type = 'button',
  color: _nativeColor,
  size = 'md',
  ...buttonProps
}: IconButtonProps): ReactElement {
  // Keep the stable piwin HTML-button API while adapting Mantine's narrower
  // optional DOM attribute contract at this library boundary.
  const mantineActionIconProps = buttonProps as ComponentPropsWithoutRef<typeof ActionIcon>;
  return (
    <ActionIcon
      {...mantineActionIconProps}
      type={type}
      className={className ? `piwin-icon-button ${className}` : 'piwin-icon-button'}
      aria-label={label}
      title={title ?? label}
      variant="subtle"
      size={size}
    />
  );
}
