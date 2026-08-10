/**
 * Context window usage ring for the composer footer.
 * Click opens a breakdown popover (Codex / Cursor style).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { IconButton, Popover } from '@piwin/ui-kit';
import type { ContextUsageSnapshot } from '@piwin/contracts';
import { DEFAULT_MODEL_CONTEXT_WINDOW } from '@piwin/contracts';
import { IconClose } from './shell-icons';

/**
 * Product-defined window used to *estimate* when the host's cached context
 * snapshot expires. Pi SDK/RPC does not expose a real cache TTL, so this is a
 * client-side assumption — never present it to the user as a provider guarantee.
 */
export const CACHE_EXPIRY_ESTIMATE_MS = 5 * 60 * 1000;

/**
 * Whole seconds remaining in the cache estimate window, or `undefined` when
 * `updatedAt` is missing, unparseable, or already past the window. Future /
 * clock-skewed timestamps are clamped to the full window so the UI never shows
 * more than `5:00`.
 */
function getCacheStatus(
  updatedAt: string | undefined,
  now: number,
): { secondsRemaining: number | undefined; isExpired: boolean } {
  if (!updatedAt) return { secondsRemaining: undefined, isExpired: false };
  const updatedMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedMs)) return { secondsRemaining: undefined, isExpired: false };
  const remainingMs = updatedMs + CACHE_EXPIRY_ESTIMATE_MS - now;
  if (remainingMs <= 0) return { secondsRemaining: undefined, isExpired: true };
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const maxSeconds = CACHE_EXPIRY_ESTIMATE_MS / 1000;
  return {
    secondsRemaining: Math.min(remainingSeconds, maxSeconds),
    isExpired: false,
  };
}

export function getCacheExpiryEstimateSeconds(
  updatedAt: string | undefined,
  now: number,
): number | undefined {
  return getCacheStatus(updatedAt, now).secondsRemaining;
}

/**
 * Formats a positive whole-second count as `M:SS` (zero-padded seconds).
 */
function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export type ContextUsageRingProps = {
  usage: ContextUsageSnapshot | null;
  /** Fallback limit from selected model config when host omits tokensLimit. */
  modelContextWindow?: number;
  /** Optional category estimates for the popover (overrides usage.breakdown). */
  breakdown?: {
    systemPromptTokens?: number;
    toolDefinitionsTokens?: number;
    rulesTokens?: number;
    skillsTokens?: number;
    mcpTokens?: number;
    conversationTokens?: number;
    source?: 'pi' | 'host-estimate';
  };
  onOpenModelSettings?: () => void;
};

/**
 * Context-window occupancy (tokens in the model window now).
 *
 * Prefer explicit `tokensUsed` from Pi context_usage. For assistant-usage that
 * only reports turn fields, use input-side tokens (prompt + cache) — that is
 * what occupied the window for the request. Do not prefer `totalTokens` when it
 * includes completion, and never invent zeros before the first usage sample.
 */
export function resolveContextTokensUsed(
  usage: ContextUsageSnapshot | null | undefined,
): number | undefined {
  if (!usage) {
    return undefined;
  }
  if (typeof usage.tokensUsed === 'number' && Number.isFinite(usage.tokensUsed)) {
    return Math.max(0, usage.tokensUsed);
  }
  const hasInputSide =
    typeof usage.promptTokens === 'number' ||
    typeof usage.cacheReadTokens === 'number' ||
    typeof usage.cacheWriteTokens === 'number';
  if (hasInputSide) {
    return (
      Math.max(0, usage.promptTokens ?? 0) +
      Math.max(0, usage.cacheReadTokens ?? 0) +
      Math.max(0, usage.cacheWriteTokens ?? 0)
    );
  }
  if (typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)) {
    return Math.max(0, usage.totalTokens);
  }
  if (
    typeof usage.completionTokens === 'number' &&
    Number.isFinite(usage.completionTokens)
  ) {
    return Math.max(0, usage.completionTokens);
  }
  return undefined;
}

export function resolveContextTokensLimit(
  usage: ContextUsageSnapshot | null | undefined,
  modelContextWindow: number | undefined,
): number {
  if (typeof modelContextWindow === 'number' && modelContextWindow > 0) {
    return modelContextWindow;
  }
  if (typeof usage?.tokensLimit === 'number' && usage.tokensLimit > 0) {
    return usage.tokensLimit;
  }
  return DEFAULT_MODEL_CONTEXT_WINDOW;
}

/** True when Host/Pi has reported a real usage sample we can render. */
export function hasRenderableContextUsage(
  usage: ContextUsageSnapshot | null | undefined,
): boolean {
  return resolveContextTokensUsed(usage) !== undefined;
}

/**
 * Percent of the selected model window that is occupied (0–100).
 * Recomputes from used/limit so host `contextRatio` (possibly against another
 * window) never disagrees with the displayed fraction.
 */
export function computeContextUsagePercent(
  usage: ContextUsageSnapshot | null | undefined,
  modelContextWindow?: number,
): number | undefined {
  const used = resolveContextTokensUsed(usage);
  if (used === undefined) {
    return undefined;
  }
  const limit = resolveContextTokensLimit(usage, modelContextWindow);
  if (limit <= 0) {
    return undefined;
  }
  return Math.round(Math.min(1, Math.max(0, used / limit)) * 100);
}

function resolveLimit(
  usage: ContextUsageSnapshot | null,
  modelContextWindow: number | undefined,
): number {
  return resolveContextTokensLimit(usage, modelContextWindow);
}

function resolveUsed(usage: ContextUsageSnapshot | null): number | undefined {
  return resolveContextTokensUsed(usage);
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
  }
  if (value >= 10_000) return `${Math.round(value / 1000)}K`;
  if (value >= 1000) {
    const k = value / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
  }
  return value.toLocaleString();
}

export function ContextUsageRing(props: ContextUsageRingProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Recompute the countdown while either the popover is open or trigger is hovered.
  // Reseed `now` whenever a fresh usage snapshot arrives so the user sees
  // an up-to-date estimate without waiting for the next 1s tick.
  useEffect(() => {
    if (!open && !hovered) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, hovered, props.usage?.updatedAt]);

  const used = resolveUsed(props.usage);
  // Hide until the first real usage sample (after a user turn + agent response).
  // Empty sessions must not show a fake 0% ring against the model window.
  if (used === undefined) {
    return null;
  }

  const limit = resolveLimit(props.usage, props.modelContextWindow);
  // Always recompute against the *displayed* limit. Host `contextRatio` may
  // have been computed against a different window (e.g. Pi default 128K while
  // the selected model is 1M) and would disagree with "~used / limit Tokens".
  const ratio = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
  const percent = Math.round(ratio * 100);
  const circumference = 2 * Math.PI * 9;
  const dashOffset = circumference * (1 - ratio);
  const tone =
    percent >= 90 ? 'critical' : percent >= 70 ? 'warn' : 'ok';

  const breakdown = props.breakdown ?? props.usage?.breakdown;
  const { secondsRemaining: cacheExpirySeconds, isExpired: isCacheExpired } =
    getCacheStatus(props.usage?.updatedAt, now);

  const rows: Array<{ label: string; tokens: number | undefined; color: string }> = [
    {
      label: 'System prompt',
      tokens: breakdown?.systemPromptTokens,
      color: '#9ca3af',
    },
    {
      label: 'Tool definitions',
      tokens: breakdown?.toolDefinitionsTokens,
      color: '#a78bfa',
    },
    {
      label: 'Rules',
      tokens: breakdown?.rulesTokens,
      color: '#34d399',
    },
    {
      label: 'Skills',
      tokens: breakdown?.skillsTokens,
      color: '#fbbf24',
    },
    {
      label: 'MCP',
      tokens: breakdown?.mcpTokens,
      color: '#c084fc',
    },
    {
      label: 'Conversation',
      tokens:
        breakdown?.conversationTokens ??
        (typeof used === 'number' ? used : undefined),
      color: '#f87171',
    },
  ];

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
        label="Context usage"
        testId="context-usage-popover"
        contentClassName="context-usage-popover"
        trigger={
          <button
            type="button"
            className={`context-usage-ring tone-${tone}${open ? ' open' : ''}`}
            data-testid="context-usage-ring"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            title={
              typeof used === 'number'
                ? `Context ${formatTokens(used)} / ${formatTokens(limit)} (${percent}%)`
                : `Context window ${formatTokens(limit)} · no usage yet`
            }
          >
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
            <span className="sr-only">
              Context usage {percent} percent. Click for details.
            </span>
          </button>
        }
      >
        <header className="context-usage-popover-header">
          <strong>Context Usage</strong>
          <IconButton label="Close" onClick={() => setOpen(false)}>
            <IconClose width={14} height={14} />
          </IconButton>
        </header>
        <div className="context-usage-popover-summary">
          <span className={`context-usage-pill tone-${tone}`}>
            {percent}% Full
          </span>
          <span className="muted">
            ~
            {typeof used === 'number' ? formatTokens(used) : '0'} /{' '}
            {formatTokens(limit)} Tokens
          </span>
        </div>
        {cacheExpirySeconds !== undefined ? (
          <p className="context-usage-cache-estimate muted">
            Cache estimate · expires in {formatCountdown(cacheExpirySeconds)}
          </p>
        ) : null}
        <div className="context-usage-bar" aria-hidden>
          <i style={{ width: `${percent}%` }} />
        </div>
        <ul className="context-usage-rows">
          {rows.map((row) => (
            <li key={row.label}>
              <span className="context-usage-row-label">
                <i style={{ background: row.color }} aria-hidden />
                {row.label}
              </span>
              <span className="context-usage-row-value muted">
                {typeof row.tokens === 'number'
                  ? formatTokens(row.tokens)
                  : '—'}
              </span>
            </li>
          ))}
        </ul>
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
              Edit context window
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
          <div className="context-usage-hover-tooltip-used">
            {percent}% ({formatTokens(used ?? 0)} / {formatTokens(limit)}) context used
          </div>
          {cacheExpirySeconds !== undefined ? (
            <div className="context-usage-hover-tooltip-cache">
              Prompt cache expires in {formatCountdown(cacheExpirySeconds)}
            </div>
          ) : isCacheExpired ? (
            <div className="context-usage-hover-tooltip-expired">
              <div>Prompt cache has expired.</div>
              <div>Higher cost expected.</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
