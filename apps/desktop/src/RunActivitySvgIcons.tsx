import { type ReactElement } from 'react';
import type { RunStatusKind } from './run-status.js';

export type ActivitySvgIconProps = {
  kind: RunStatusKind;
  lucideName?: string | undefined;
  className?: string | undefined;
  'data-testid'?: string | undefined;
};

export function ActivitySvgIcon(props: ActivitySvgIconProps): ReactElement {
  const { kind, className, 'data-testid': testId } = props;

  switch (kind) {
    case 'connecting-model':
      return (
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`run-activity-svg-icon kind-connecting ${className ?? ''}`}
          {...(testId !== undefined ? { 'data-testid': testId } : {})}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="conn-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--accent, #3b82f6)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--accent, #3b82f6)" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="conn-arc" x1="0" y1="0" x2="32" y2="32">
              <stop offset="0%" stopColor="var(--accent, #3b82f6)" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r="14" fill="url(#conn-glow)" className="svg-pulse-bg" />
          <circle
            cx="16"
            cy="16"
            r="12"
            stroke="var(--accent, #3b82f6)"
            strokeOpacity="0.25"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <circle
            cx="16"
            cy="16"
            r="9"
            stroke="url(#conn-arc)"
            strokeWidth="2"
            strokeLinecap="round"
            className="svg-spin-fast"
            strokeDasharray="24 16"
          />
          <circle cx="16" cy="16" r="3.5" fill="var(--accent, #3b82f6)" className="svg-node-pulse" />
          <circle cx="16" cy="16" r="1.5" fill="#ffffff" />
        </svg>
      );

    case 'waiting-first-token':
      return (
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`run-activity-svg-icon kind-waiting-token ${className ?? ''}`}
          {...(testId !== undefined ? { 'data-testid': testId } : {})}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="token-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="16" cy="16" r="14" fill="url(#token-glow)" className="svg-pulse-bg" />
          {/* Breathing Starburst / Sparks */}
          <g className="svg-starburst">
            <path
              d="M16 4V8M16 24V28M4 16H8M24 16H28"
              stroke="#c084fc"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M7.5 7.5L10.3 10.3M21.7 21.7L24.5 24.5M7.5 24.5L10.3 21.7M21.7 10.3L24.5 7.5"
              stroke="#a855f7"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeOpacity="0.7"
            />
          </g>
          <circle cx="16" cy="16" r="4" fill="#c084fc" className="svg-core-breathe" />
          <circle cx="16" cy="16" r="2" fill="#ffffff" />
        </svg>
      );

    case 'planning':
      return (
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`run-activity-svg-icon kind-planning ${className ?? ''}`}
          {...(testId !== undefined ? { 'data-testid': testId } : {})}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="plan-grad" x1="0" y1="0" x2="32" y2="32">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
          {/* Tactical compass / Blueprint grid */}
          <rect
            x="4"
            y="4"
            width="24"
            height="24"
            rx="5"
            stroke="url(#plan-grad)"
            strokeWidth="1.5"
            strokeOpacity="0.3"
          />
          <path d="M16 4V28M4 16H28" stroke="url(#plan-grad)" strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
          <circle cx="16" cy="16" r="8" stroke="url(#plan-grad)" strokeWidth="1.5" className="svg-spin-slow" strokeDasharray="18 12" />
          <path d="M16 10L19 16L16 22L13 16Z" fill="url(#plan-grad)" className="svg-compass-needle" />
          <circle cx="16" cy="16" r="2" fill="#ffffff" />
        </svg>
      );

    case 'working':
      return (
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`run-activity-svg-icon kind-working ${className ?? ''}`}
          {...(testId !== undefined ? { 'data-testid': testId } : {})}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="work-grad" x1="0" y1="0" x2="32" y2="32">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="50%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
          {/* Dual spinning gear / matrix rings */}
          <circle
            cx="16"
            cy="16"
            r="13"
            stroke="url(#work-grad)"
            strokeWidth="2"
            strokeLinecap="round"
            className="svg-spin-gear"
            strokeDasharray="22 10 8 10"
          />
          <circle
            cx="16"
            cy="16"
            r="8"
            stroke="url(#work-grad)"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="svg-spin-reverse"
            strokeDasharray="12 12"
            strokeOpacity="0.75"
          />
          <circle cx="16" cy="16" r="3.5" fill="#10b981" className="svg-node-pulse" />
          <path d="M14.5 13.5L12 16L14.5 18.5M17.5 13.5L20 16L17.5 18.5" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'waiting-permission':
      return (
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`run-activity-svg-icon kind-permission ${className ?? ''}`}
          {...(testId !== undefined ? { 'data-testid': testId } : {})}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="perm-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="16" cy="16" r="14" fill="url(#perm-glow)" className="svg-pulse-bg" />
          <path
            d="M16 4L26 8V15C26 21.5 21.7 26.5 16 28C10.3 26.5 6 21.5 6 15V8L16 4Z"
            stroke="#f59e0b"
            strokeWidth="2"
            strokeLinejoin="round"
            fill="#f59e0b"
            fillOpacity="0.15"
            className="svg-shield-pulse"
          />
          <path
            d="M16 11V17M16 21H16.01"
            stroke="#f59e0b"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'compacting':
      return (
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`run-activity-svg-icon kind-compacting ${className ?? ''}`}
          {...(testId !== undefined ? { 'data-testid': testId } : {})}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="comp-grad" x1="0" y1="0" x2="32" y2="32">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
          </defs>
          {/* Lattice collapse funnel */}
          <rect x="5" y="5" width="22" height="22" rx="4" stroke="url(#comp-grad)" strokeWidth="1.5" strokeOpacity="0.3" />
          <path d="M7 11L16 16L25 11M7 21L16 16L25 21" stroke="url(#comp-grad)" strokeWidth="1.5" strokeLinecap="round" className="svg-compact-lattice" />
          <path d="M12 8L16 16L20 8M12 24L16 16L20 24" stroke="url(#comp-grad)" strokeWidth="1" strokeOpacity="0.6" />
          <circle cx="16" cy="16" r="3" fill="#ec4899" className="svg-core-breathe" />
        </svg>
      );

    case 'complete':
      return (
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`run-activity-svg-icon kind-complete ${className ?? ''}`}
          {...(testId !== undefined ? { 'data-testid': testId } : {})}
          aria-hidden="true"
        >
          <circle cx="16" cy="16" r="13" stroke="#10b981" strokeWidth="2.5" fill="#10b981" fillOpacity="0.12" />
          <path
            d="M9.5 16.5L14 21L22.5 11"
            stroke="#10b981"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="svg-check-draw"
          />
        </svg>
      );

    case 'failed':
      return (
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`run-activity-svg-icon kind-failed ${className ?? ''}`}
          {...(testId !== undefined ? { 'data-testid': testId } : {})}
          aria-hidden="true"
        >
          <circle cx="16" cy="16" r="13" stroke="#ef4444" strokeWidth="2.5" fill="#ef4444" fillOpacity="0.12" />
          <path
            d="M11 11L21 21M21 11L11 21"
            stroke="#ef4444"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'stopping':
    case 'stopped':
      return (
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`run-activity-svg-icon kind-stopping ${className ?? ''}`}
          {...(testId !== undefined ? { 'data-testid': testId } : {})}
          aria-hidden="true"
        >
          <circle cx="16" cy="16" r="13" stroke="var(--content-secondary, #94a3b8)" strokeWidth="2" strokeDasharray="4 4" />
          <rect x="11" y="11" width="10" height="10" rx="2" fill="var(--content-secondary, #94a3b8)" className="svg-stop-pulse" />
        </svg>
      );

    case 'idle':
    default:
      return (
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`run-activity-svg-icon kind-idle ${className ?? ''}`}
          {...(testId !== undefined ? { 'data-testid': testId } : {})}
          aria-hidden="true"
        >
          <circle cx="16" cy="16" r="12" stroke="var(--content-tertiary, #cbd5e1)" strokeWidth="1.5" strokeDasharray="2 2" />
          <circle cx="16" cy="16" r="4" fill="var(--content-tertiary, #cbd5e1)" />
        </svg>
      );
  }
}
