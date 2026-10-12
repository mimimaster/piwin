/**
 * Context occupancy ring. Renders selector output only — no occupancy math.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { formatCompactTokens } from '@piwin/contracts';
import { IconButton, Popover } from '@piwin/ui-kit';
import { IconChevronRight, IconClose } from './shell-icons';
import { ConversationUsageDetails, contextUsageTone } from './conversation-usage-details.js';
import type { ContextRingViewModel } from './context-telemetry-selector.js';
import { getContextUsageCopy } from './conversation-usage-copy.js';

/**
 * Product-defined window used to *estimate* when the prompt cache expires.
 * Pi does not expose a real TTL — never present this as a provider guarantee.
 */
export const CACHE_EXPIRY_ESTIMATE_MS = 5 * 60 * 1000;

export function getCacheExpiryEstimateSeconds(
  updatedAt: string | undefined,
  now: number,
): number | undefined {
  if (!updatedAt) return undefined;
  const updatedMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedMs)) return undefined;
  const remainingMs = updatedMs + CACHE_EXPIRY_ESTIMATE_MS - now;
  if (remainingMs <= 0) return undefined;
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const maxSeconds = CACHE_EXPIRY_ESTIMATE_MS / 1000;
  return Math.min(remainingSeconds, maxSeconds);
}

export function formatCacheCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export type ContextUsageRingProps = {
  view: ContextRingViewModel;
  onOpenModelSettings?: () => void;
  /** `bar`: the status bar's thin bar with numbers; same popover. */
  variant?: 'ring' | 'bar';
  /** Extra controls at the bottom of the popover. */
  footerExtra?: ReactNode;
};

function ContextUsageBarTrigger(props: { view: ContextRingViewModel }): ReactElement {
  const { view } = props;
  const zh = view.locale === 'zh-CN';
  if (view.compacting) {
    return <span className="context-usage-bar-status">{zh ? '⟳ 压缩中' : '⟳ compacting'}</span>;
  }
  if (view.numericHidden || view.percentText === undefined) {
    return <span className="context-usage-bar-status">ctx …</span>;
  }
  const estimated = view.quality !== 'measured' || view.occupancySource === 'last-confirmed';
  return (
    <>
      <span className="context-usage-bar-label">ctx</span>
      <span className="context-usage-bar-track" aria-hidden>
        <span className="context-usage-bar-fill" style={{ width: `${Math.min(100, Math.max(0, view.arcRatio * 100))}%` }} />
      </span>
      <span className="context-usage-bar-percent">{`${estimated ? '~' : ''}${view.percentText}%`}</span>
      {view.tokensUsed !== undefined && view.tokensLimit !== undefined ? (
        <span className="context-usage-bar-amount">
          {`${formatCompactTokens(view.tokensUsed)}/${formatCompactTokens(view.tokensLimit)}`}
        </span>
      ) : null}
    </>
  );
}

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

  const [, setTick] = useState(0);
  const watchingEstimate = open || hovered;
  const cacheExpirySeconds = getCacheExpiryEstimateSeconds(view.cacheAnchorAt, Date.now());
  useEffect(() => {
    if (!watchingEstimate || cacheExpirySeconds === undefined) {
      return;
    }
    const id = window.setInterval(() => {
      setTick((tick) => tick + 1);
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [watchingEstimate, cacheExpirySeconds, view.cacheAnchorAt]);

  if (!view.visible) {
    return null;
  }

  const cacheEstimate =
    cacheExpirySeconds !== undefined
      ? getContextUsageCopy(view.locale).cacheEstimate(formatCacheCountdown(cacheExpirySeconds))
      : undefined;
  const tone = contextUsageTone(view.percentText);
  const circumference = 2 * Math.PI * 9;
  const dashOffset = circumference * (1 - view.arcRatio);

  return (
    <div
      className={`context-usage-ring-root${props.variant === 'bar' ? ' is-bar' : ''}`}
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
          props.variant === 'bar' ? (
            <button
              type="button"
              className={`context-usage-bar tone-${tone}${open ? ' open' : ''}`}
              data-testid="context-usage-bar"
              aria-label={view.labels.accessibleLabel}
              onFocus={() => setHovered(true)}
              onBlur={() => setHovered(false)}
            >
              <ContextUsageBarTrigger view={view} />
            </button>
          ) : (
          <button
            type="button"
            className={`context-usage-ring tone-${tone}${open ? ' open' : ''}`}
            data-testid="context-usage-ring"
            aria-label={view.labels.accessibleLabel}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
          >
            {view.numericHidden ? (
              <span className="context-usage-ring-status" aria-hidden>
                …
              </span>
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
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
          )
        }
      >
        <header className="context-usage-popover-header">
          <strong className="context-usage-popover-title">{view.labels.title}</strong>
          <IconButton label={view.labels.close} onClick={() => setOpen(false)}>
            <IconClose width={14} height={14} />
          </IconButton>
        </header>
        <ConversationUsageDetails
          view={view}
          {...(cacheEstimate !== undefined ? { cacheEstimate } : {})}
        />
        {props.footerExtra}
        {props.onOpenModelSettings ? (
          <footer className="context-usage-popover-footer">
            <button
              type="button"
              className="context-usage-settings"
              data-testid="context-usage-settings"
              onClick={() => {
                setOpen(false);
                props.onOpenModelSettings?.();
              }}
            >
              <span>{view.labels.settings}</span>
              <IconChevronRight width={12} height={12} />
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
          {cacheEstimate ? (
            <div
              className="context-usage-hover-tooltip-cache"
              data-testid="context-usage-cache-estimate"
            >
              {cacheEstimate}
            </div>
          ) : null}
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {phaseChanged ? `${view.labels.status} ${view.labels.accessibleLabel}` : ''}
      </span>
    </div>
  );
}
