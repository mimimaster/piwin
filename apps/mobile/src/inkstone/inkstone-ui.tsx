import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Icon, type InkstoneIconName } from './icons.js';
import { useInkstone } from './inkstone-context.js';
import { useLiveCall } from './host/live-call-context.js';

export type DotStatus = 'running' | 'done' | 'waiting' | 'background' | 'paused' | 'failed' | '';

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

/**
 * Floating handle for a live call while the user is elsewhere in the app.
 * Everything it shows and does is the Host call (`useLiveCall`).
 */
export function LiveCapsule(): ReactElement | null {
  const { state, dispatch } = useInkstone();
  const live = useLiveCall();
  const call = live?.call ?? null;
  if (live === null || call === null || state.route === 'voice') {
    return null;
  }
  const muted = live.peer.muted;
  const activity =
    call.activity === 'user-speaking'
      ? '正在听你说'
      : call.activity === 'assistant-speaking'
        ? '正在回答'
        : call.activity === 'agent-working'
          ? '正在处理任务'
          : muted
            ? '已静音'
            : '正在聆听';
  return (
    <div className="live-capsule" role="region" aria-label="Live 悬浮小部件">
      <button
        className="capsule-body"
        onClick={() => dispatch({ type: 'navigate', route: 'voice' })}
        aria-label="返回全屏 Live"
        type="button"
      >
        <Dot status="running" />
        <span className="capsule-text">
          <strong>Live · {activity}</strong>
          <small>{muted ? '轻点麦克风开麦' : '可以边说边看'}</small>
        </span>
      </button>
      <div className="capsule-controls">
        <button
          className={`capsule-btn ${muted ? 'is-muted' : ''}`.trim()}
          onClick={() => void live.setMuted(!muted)}
          aria-label={muted ? '取消静音' : '静音'}
          type="button"
        >
          <Icon name={muted ? 'close' : 'mic'} />
        </button>
        <button
          className="capsule-btn capsule-hangup"
          onClick={() => void live.end()}
          aria-label="结束 Live"
          type="button"
        >
          <Icon name="stop" />
        </button>
      </div>
    </div>
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
    <>
      <header className="topbar">
        {onBack !== undefined ? (
          <IconButton name="chevl" label="返回" onClick={onBack} extra="back-button" />
        ) : (
          <span className="brand-seal">砚</span>
        )}
        <div className="topbar-title">
          <h2>{title}</h2>
          {subtitle !== undefined ? <small>{subtitle}</small> : null}
        </div>
        {right}
      </header>
      <LiveCapsule />
    </>
  );
}

const BOTTOM_NAV_ITEMS: [string, InkstoneIconName, string][] = [
  ['sessions', 'panel', '会话'],
  ['activity', 'bell', '动态'],
  ['knowledge', 'book', '知识'],
  ['desk', 'desk', '案头'],
];

export function BottomNav({
  selected,
  attentionCount = 0,
  inboxCount = 0,
  onNavigate,
}: {
  selected: string;
  attentionCount?: number;
  inboxCount?: number;
  onNavigate: (route: string) => void;
}): ReactElement {
  const count = attentionCount || inboxCount;
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
          {route === 'activity' && count > 0 ? (
            <b className="nav-counter">{count}</b>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

export function Segmented<T extends string>({
  items,
  selected,
  onSelect,
  label,
}: {
  items: [T, number | undefined][];
  selected: T;
  onSelect: (value: T) => void;
  label?: string;
}): ReactElement {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {items.map(([value, count]) => (
        <button
          key={value}
          onClick={() => onSelect(value)}
          aria-pressed={selected === value}
          type="button"
        >
          {value}
          {count !== undefined ? <small>{count}</small> : null}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({
  items,
  selected,
  onSelect,
}: {
  items: [T, number | undefined][];
  selected: T;
  onSelect: (value: T) => void;
}): ReactElement {
  return (
    <div className="chip-row">
      {items.map(([value, count]) => (
        <button
          key={value}
          className="chip"
          onClick={() => onSelect(value)}
          aria-pressed={selected === value}
          type="button"
        >
          {value}
          {count !== undefined ? <small>{count}</small> : null}
        </button>
      ))}
    </div>
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
  disabled = false,
}: {
  children: ReactNode;
  variant?: '' | 'secondary' | 'subtle';
  onClick: () => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <button
      className={`full-button ${variant}`.trim()}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
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
