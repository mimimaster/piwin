/**
 * Settings page/section heading template: title + optional description.
 * UI-pure (no host access); candidate for later promotion to @piwin/ui-kit.
 * Reuses the existing `settings-card-heading` markup so current CSS applies.
 */
import type { ReactElement, ReactNode } from 'react';

export type PageTitleProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Optional right-aligned slot (badge, count, action). */
  trailing?: ReactNode;
};

export function PageTitle(props: PageTitleProps): ReactElement {
  return (
    <div className="settings-card-heading">
      <div className="settings-card-heading-body">
        <h4>{props.title}</h4>
        {props.description ? <p>{props.description}</p> : null}
      </div>
      {props.trailing ? <div className="settings-card-heading-trailing">{props.trailing}</div> : null}
    </div>
  );
}
