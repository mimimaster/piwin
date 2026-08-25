import type { ReactElement, ReactNode } from 'react';
import { IconButton } from '@piwin/ui-kit';
import { IconArrowLeft, IconClose, IconSearch } from '../../shell-icons';

/**
 * Chrome shared by the Images / Videos studio pages: a slim topbar, a left
 * creation/library rail, and pill controls. Pure layout — no data concerns.
 */

export type StudioTopbarProps = {
  testId: string;
  backLabel: string;
  onBack: () => void;
  icon: ReactNode;
  title: string;
  countLabel?: string;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** Extra controls rendered between search and the close button. */
  actions?: ReactNode;
};

export function StudioTopbar(props: StudioTopbarProps): ReactElement {
  return (
    <header className="studio-topbar">
      <div className="studio-topbar-identity">
        <button
          type="button"
          className="studio-back-btn"
          data-testid={props.testId}
          onClick={props.onBack}
        >
          <IconArrowLeft width={14} height={14} />
          <span>{props.backLabel}</span>
        </button>
        <div className="studio-title-badge">{props.icon}</div>
        <h1 className="studio-title">{props.title}</h1>
        {props.countLabel !== undefined && (
          <span className="studio-count-badge">{props.countLabel}</span>
        )}
      </div>
      <div className="studio-topbar-actions">
        {props.searchPlaceholder !== undefined && (
          <label className="studio-search-well">
            <IconSearch width={14} height={14} />
            <input
              type="text"
              placeholder={props.searchPlaceholder}
              value={props.searchValue ?? ''}
              onChange={(e) => props.onSearchChange?.(e.target.value)}
            />
          </label>
        )}
        {props.actions}
        <IconButton label="Close" title="Close" onClick={props.onBack}>
          <IconClose width={16} height={16} />
        </IconButton>
      </div>
    </header>
  );
}

export function StudioRail(props: { children: ReactNode }): ReactElement {
  return <aside className="studio-rail">{props.children}</aside>;
}

export function RailSection(props: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="rail-section">
      <h2 className="rail-section-title">{props.title}</h2>
      {props.children}
    </section>
  );
}

/** Label + control row inside a rail section. */
export function RailField(props: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="rail-field">
      <span className="rail-field-label">{props.label}</span>
      {props.children}
    </div>
  );
}

export function PillGroup(props: { children: ReactNode }): ReactElement {
  return <div className="pill-group">{props.children}</div>;
}

export function PillButton(props: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      className={`pill-btn${props.active ? ' active' : ''}`}
      onClick={props.onClick}
      {...(props.title !== undefined ? { title: props.title } : {})}
    >
      {props.children}
    </button>
  );
}
