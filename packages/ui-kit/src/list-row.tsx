import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

export type ListRowProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode;
  selected?: boolean;
  compact?: boolean;
};

/**
 * Keyboard-native selectable row for navigators, inspector sections, and
 * settings lists. Domain components supply the icon, label, and metadata.
 */
export function ListRow({
  children,
  selected = false,
  compact = false,
  className,
  type = 'button',
  ...buttonProps
}: ListRowProps): ReactElement {
  const rootClassName = [
    'piwin-list-row',
    selected ? 'is-selected' : '',
    compact ? 'is-compact' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button {...buttonProps} type={type} className={rootClassName} aria-current={selected ? 'page' : undefined}>
      {children}
    </button>
  );
}
