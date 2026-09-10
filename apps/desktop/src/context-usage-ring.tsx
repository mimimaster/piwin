/**
 * Context occupancy ring. Renders selector output only — no occupancy math.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { IconButton, Popover } from '@piwin/ui-kit';
import { IconClose } from './shell-icons';
import { ConversationUsageDetails } from './conversation-usage-details.js';
import { formatUsageTokenCount } from './conversation-usage-copy.js';
import type { ContextRingViewModel } from './context-telemetry-selector.js';

export type ContextUsageRingProps = {
  view: ContextRingViewModel;
  onOpenModelSettings?: () => void;
};

export function ContextUsageRing(props: ContextUsageRingProps): ReactElement | null {
  const { view } = props;
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const previousVisible = useRef(view.visible);
  const previousPhase = useRef(view.phase);
  const phaseChanged =
    previousVisible.current !== view.visible || previousPhase.current !== view.phase;

  useEffect(() => {
    previousVisible.current = view.visible;
    previousPhase.current = view.phase;
  }, [view.phase, view.visible]);

  if (!view.visible) {
    return null;
  }

  const tone =
    (view.percentText ?? 0) >= 90 ? 'critical' : (view.percentText ?? 0) >= 70 ? 'warn' : 'ok';
  const circumference = 2 * Math.PI * 9;
  const dashOffset = circumference * (1 - view.arcRatio);

  const tokenLabel =
    !view.numericHidden &&
    typeof view.tokensUsed === 'number' &&
    typeof view.tokensLimit === 'number'
      ? `${formatUsageTokenCount(view.tokensUsed)} / ${formatUsageTokenCount(view.tokensLimit)}`
      : null;

  return (
    <div
      className="context-usage-ring-root"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
        label={view.labels.title}
        testId="context-usage-popover"
        contentClassName="context-usage-popover"
        trigger={
          <button
            type="button"
            className={`context-usage-ring tone-${tone}${open ? ' open' : ''}`}
            data-testid="context-usage-ring"
            aria-label={view.labels.accessibleLabel}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
          >
            {tokenLabel ? (
              <span className="context-usage-token-text mono" data-testid="context-usage-token-text">
                {tokenLabel}
              </span>
            ) : null}
            {view.numericHidden ? (
              <span className="context-usage-ring-status" aria-hidden>
                …
              </span>
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden className="context-usage-svg">
                <circle
                  className="context-usage-ring-track"
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  strokeWidth="2.5"
                />
                <circle
                  className="context-usage-ring-progress"
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  strokeWidth="2.5"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  transform="rotate(-90 12 12)"
                />
              </svg>
            )}
          </button>
        }
      >
        <header className="context-usage-popover-header">
          <strong>{view.labels.title}</strong>
          <IconButton label={view.labels.close} onClick={() => setOpen(false)}>
            <IconClose width={14} height={14} />
          </IconButton>
        </header>
        <div className="context-usage-popover-summary">
          {view.numericHidden ? (
            <span className="muted">{view.labels.status}</span>
          ) : (
            <>
              <span className={`context-usage-pill tone-${tone}`}>{view.labels.percentFull}</span>
              <span className="muted">{view.labels.hover}</span>
            </>
          )}
        </div>
        {view.labels.status ? (
          <p className="muted" data-testid="context-usage-status">
            {view.labels.status}
          </p>
        ) : null}
        {view.labels.limitNote ? (
          <p className="muted" data-testid="context-usage-limit-note">
            {view.labels.limitNote}
          </p>
        ) : null}
        {view.exceedsLimit ? (
          <p className="muted" data-testid="context-usage-exceeds">
            {view.labels.exceeds}
          </p>
        ) : null}
        <ConversationUsageDetails view={view} />
        {props.onOpenModelSettings ? (
          <footer className="context-usage-popover-footer muted">
            <button
              type="button"
              className="linkish-btn"
              onClick={() => {
                setOpen(false);
                props.onOpenModelSettings?.();
              }}
            >
              {view.labels.settings}
            </button>
          </footer>
        ) : null}
      </Popover>
      {hovered && !open ? (
        <div
          className="context-usage-hover-tooltip"
          role="tooltip"
          data-testid="context-usage-hover-tooltip"
        >
          <div className="context-usage-hover-tooltip-used">{view.labels.hover}</div>
          {view.labels.status ? (
            <div className="context-usage-hover-tooltip-cache">{view.labels.status}</div>
          ) : null}
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {phaseChanged ? `${view.labels.status} ${view.labels.accessibleLabel}` : ''}
      </span>
    </div>
  );
}
