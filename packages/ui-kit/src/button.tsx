import type { ButtonHTMLAttributes, ReactElement } from 'react';

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
  const classNames = ['btn'];
  if (variant === 'primary') classNames.push('primary');
  if (variant === 'ghost') classNames.push('btn-ghost');
  if (variant === 'danger') classNames.push('btn-danger');
  if (size === 'compact') classNames.push('btn-compact');
  if (className) classNames.push(className);
  return classNames.join(' ');
}

/** Semantic action button with visual tokens provided by the host application. */
export function Button({
  variant = 'secondary',
  size = 'default',
  className,
  type = 'button',
  ...buttonProps
}: ButtonProps): ReactElement {
  return (
    <button
      {...buttonProps}
      type={type}
      className={buildButtonClassName(variant, size, className)}
    />
  );
}
