import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Icon, type InkstoneIconName } from './icons.js';

export type DotStatus = 'running' | 'done' | 'waiting' | 'background' | '';

export function Dot({ status }: { status: DotStatus }): ReactElement {
  return <i className={`dot ${status}`.trim()} aria-hidden="true" />;
}

export function Pill({
  variant = '',
  children,
  onClick,
  style,
  mono = false,
}: {
  variant?: '' | 'pine' | 'zhu' | 'azure';
  children: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
  mono?: boolean;
}): ReactElement {
  const className = `pill ${variant} ${mono ? 'mono' : ''}`.trim();
  if (onClick === undefined) {
    return (
      <span className={className} style={style}>
        {children}
      </span>
    );
  }
  return (
    <button className={className} style={style} onClick={onClick}>
      {children}
    </button>
  );
}

export function IconButton({
  name,
  label,
  onClick,
  extra = '',
}: {
  name: InkstoneIconName;
  label: string;
  onClick: () => void;
  extra?: string;
}): ReactElement {
  return (
    <button
      className={`icon-button ${extra}`.trim()}
      onClick={onClick}
      aria-label={label}
      type="button"
    >
      <Icon name={name} />
    </button>
  );
}

export function TopBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
}): ReactElement {
  return (
    <header className="topbar">
      {onBack !== undefined ? (
        <IconButton name="chevr" label="返回" onClick={onBack} extra="back-button" />
      ) : (
        <span className="brand-seal">砚</span>
      )}
      <div className="topbar-title">
        <h2>{title}</h2>
        {subtitle !== undefined ? <small>{subtitle}</small> : null}
      </div>
      {right}
    </header>
  );
}

const BOTTOM_NAV_ITEMS: [string, InkstoneIconName, string][] = [
  ['sessions', 'panel', '会话'],
  ['inbox', 'bulb', '待办'],
  ['shelf', 'cards', '案头'],
];

export function BottomNav({
  selected,
  inboxCount,
  onNavigate,
}: {
  selected: string;
  inboxCount: number;
  onNavigate: (route: string) => void;
}): ReactElement {
  return (
    <nav className="bottom-nav" aria-label="手机主导航">
      {BOTTOM_NAV_ITEMS.map(([route, name, title]) => (
        <button
          key={route}
          className={route === selected ? 'active' : ''}
          aria-current={route === selected ? 'page' : undefined}
          onClick={() => onNavigate(route)}
          type="button"
        >
          <Icon name={name} />
          <span>{title}</span>
          {route === 'inbox' && inboxCount > 0 ? <b className="nav-counter">{inboxCount}</b> : null}
        </button>
      ))}
    </nav>
  );
}

export function ScreenHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): ReactElement {
  return (
    <div className="screen-heading">
      <h1>{title}</h1>
      {subtitle !== undefined ? <p>{subtitle}</p> : null}
    </div>
  );
}

export function TabsRow({
  items,
  selected,
  onSelect,
  extra = '',
}: {
  items: string[];
  selected: string;
  onSelect: (value: string) => void;
  extra?: string;
}): ReactElement {
  return (
    <div className={`tabs ${extra}`.trim()}>
      {items.map((item) => (
        <button
          key={item}
          className={selected === item ? 'active' : ''}
          aria-pressed={selected === item}
          onClick={() => onSelect(item)}
          type="button"
        >
          {item}
        </button>
      ))}
    </div>
  );
}

export function FullButton({
  children,
  variant = '',
  onClick,
}: {
  children: ReactNode;
  variant?: '' | 'secondary' | 'subtle';
  onClick: () => void;
}): ReactElement {
  return (
    <button className={`full-button ${variant}`.trim()} onClick={onClick} type="button">
      {children}
    </button>
  );
}

export function SealButton({
  children,
  ghost = false,
  onClick,
  disabled = false,
  label,
}: {
  children: ReactNode;
  ghost?: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}): ReactElement {
  return (
    <button
      className={`seal-button ${ghost ? 'ghost' : ''}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function ListRow({
  name,
  title,
  subtitle,
  onClick,
  trailing,
  selected = false,
}: {
  name: InkstoneIconName;
  title: ReactNode;
  subtitle?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  selected?: boolean;
}): ReactElement {
  return (
    <button
      className={`list-row ${selected ? 'selected' : ''}`.trim()}
      onClick={onClick}
      type="button"
    >
      <Icon name={name} />
      <span className="grow">
        <strong>{title}</strong>
        {subtitle !== undefined ? <small>{subtitle}</small> : null}
      </span>
      <span className="trailing">{trailing ?? <Icon name="chevr" />}</span>
    </button>
  );
}

export function SectionLabel({
  children,
  onClick,
  actionLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  actionLabel?: string;
}): ReactElement {
  return (
    <div className="section-label">
      {children}
      {onClick !== undefined && actionLabel !== undefined ? (
        <button onClick={onClick} type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function RadioOptions({
  values,
  selected,
  onSelect,
}: {
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
}): ReactElement {
  return (
    <div className="radio-options">
      {values.map((value) => (
        <button
          key={value}
          aria-pressed={selected === value}
          onClick={() => onSelect(value)}
          type="button"
        >
          {value}
        </button>
      ))}
    </div>
  );
}

export function SwitchRow({
  title,
  subtitle,
  checked,
  onToggle,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <button
      className="list-row"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      type="button"
    >
      <span className="grow">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      <span className="switch" />
    </button>
  );
}

export function Facts({ items }: { items: [string, ReactNode][] }): ReactElement {
  return (
    <dl className="facts">
      {items.map(([term, detail]) => (
        <FragmentRow key={term} term={term} detail={detail} />
      ))}
    </dl>
  );
}

function FragmentRow({ term, detail }: { term: string; detail: ReactNode }): ReactElement {
  return (
    <>
      <dt>{term}</dt>
      <dd>{detail}</dd>
    </>
  );
}
