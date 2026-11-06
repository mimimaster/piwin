import type { ReactElement, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Compact supporting metric: its icon always has a readable explanation. */
export function UsageSummaryDetail({ icon: Icon, label, children }: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <span className="usage-summary-detail" title={label}>
      <Icon size={13} aria-hidden="true" />
      <span className="sr-only">{label}: </span>
      <span>{children}</span>
    </span>
  );
}
