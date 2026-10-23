/**
 * Leaf pieces of the subagent cards. Kept apart from the rows so the ticking
 * clock re-renders only its own text node, never the memoized row around it.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { formatSubagentElapsed, type SubagentInvocationVisualStatus } from './subagent-card-view';

export function SubagentSeal(props: {
  glyph: string;
  status: SubagentInvocationVisualStatus;
}): ReactElement {
  return (
    <span
      className="subagent-seal"
      data-status={props.status}
      data-testid="subagent-seal"
      aria-hidden="true"
    >
      {props.glyph}
    </span>
  );
}

export function SubagentSpinner(): ReactElement {
  return <span className="subagent-grind-spinner" aria-hidden="true" />;
}

function useTickingNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

/**
 * Elapsed since `startedAt`. While `active` it measures to "now" — the Host
 * only moves `updatedAt` when the child reports something, so a blocked child
 * must not freeze at its last event — otherwise to `endedAt`.
 */
export function SubagentElapsed(props: {
  startedAt?: string | undefined;
  endedAt?: string | undefined;
  active: boolean;
  className?: string;
  testId?: string;
}): ReactElement | null {
  const now = useTickingNow(props.active && props.startedAt !== undefined);
  if (props.startedAt === undefined) return null;
  const end = props.active
    ? now
    : props.endedAt !== undefined
      ? Date.parse(props.endedAt)
      : Number.NaN;
  const text = formatSubagentElapsed(Date.parse(props.startedAt), end);
  if (!text) return null;
  return (
    <span className={props.className} data-testid={props.testId ?? 'subagent-elapsed'}>
      {text}
    </span>
  );
}
