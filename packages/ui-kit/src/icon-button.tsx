import type { ButtonHTMLAttributes, ReactElement } from 'react';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  label: string;
};

/** Secondary visual actions always provide an accessible label and tooltip. */
export function IconButton({
  label,
  className,
  title,
  type = 'button',
  ...buttonProps
}: IconButtonProps): ReactElement {
  return (
    <button
      {...buttonProps}
      type={type}
      className={className ? `icon-btn ${className}` : 'icon-btn'}
      aria-label={label}
      title={title ?? label}
    />
  );
}
