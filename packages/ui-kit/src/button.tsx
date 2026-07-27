import { Button as MantineButton } from '@mantine/core';
import type {
  ButtonHTMLAttributes,
  ComponentPropsWithoutRef,
  ReactElement,
} from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'default' | 'compact';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

function buildButtonClassName(
  variant: ButtonVariant,
  size: ButtonSize,
  className: string | undefined,
): string {
  const classNames = ['piwin-button', `piwin-button--${variant}`, `piwin-button--${size}`];
  if (className) classNames.push(className);
  return classNames.join(' ');
}

/** Semantic action button with visual tokens provided by the host application. */
export function Button({
  variant = 'secondary',
  size = 'default',
  className,
  type = 'button',
  color: _nativeColor,
  ...buttonProps
}: ButtonProps): ReactElement {
  const mantineVariant =
    variant === 'primary' ? 'filled' : variant === 'ghost' ? 'subtle' : 'default';
  // Mantine intentionally narrows optional DOM attributes under exactOptionalPropertyTypes.
  const mantineButtonProps = buttonProps as ComponentPropsWithoutRef<typeof MantineButton>;
  return (
    <MantineButton
      {...mantineButtonProps}
      type={type}
      className={buildButtonClassName(variant, size, className)}
      variant={mantineVariant}
      size={size === 'compact' ? 'compact-sm' : 'sm'}
      {...(variant === 'danger' ? { color: 'red' } : {})}
    />
  );
}
