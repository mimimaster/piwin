/**
 * Animated carousel for active subagent work. Cycles through active children
 * with a restrained vertical fade/slide, pauses on hover/focus, and falls
 * back to a single stable item under reduced motion. Every entry opens the
 * same read-only session inspector.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ActiveSubagentView } from './subagent-activity-model';
import { subagentStatusToRunKind, toInspectorSelection } from './subagent-activity-model';
import { ActivitySvgIcon } from './RunActivitySvgIcons.js';

const CYCLE_INTERVAL_MS = 2200;

export type SubagentActivityTickerProps = {
  items: ActiveSubagentView[];
  onInspect: (selection: {
    childSessionId: string;
    displayName: string;
    taskSummary: string;
  }) => void;
};

export function SubagentActivityTicker(props: SubagentActivityTickerProps): ReactElement | null {
  const reduced = useReducedMotion() ?? false;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Reset only when the active set shrinks/grows — not on hover/focus pause.
  useEffect(() => {
    setIndex(0);
  }, [props.items.length]);

  useEffect(() => {
    if (index >= props.items.length && props.items.length > 0) {
      setIndex(0);
    }
  }, [index, props.items.length]);

  useEffect(() => {
    if (reduced || paused || props.items.length <= 1) {
      return;
    }
    const id = window.setInterval(
      () => setIndex((current) => (current + 1) % props.items.length),
      CYCLE_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [props.items.length, reduced, paused]);

  const item = props.items[index] ?? props.items[0];
  if (item === undefined) {
    return null;
  }

  return (
    <button
      type="button"
      className="subagent-activity-ticker"
      data-testid="subagent-activity-ticker"
      onClick={() => props.onInspect(toInspectorSelection(item))}
      aria-label={`${item.displayName}: ${item.latestActivity}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      title={item.latestActivity}
    >
      <ActivitySvgIcon
        kind={subagentStatusToRunKind(item.status)}
        className="subagent-status-icon"
      />
      <span className="subagent-ticker-activity">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={item.childSessionId}
            className="subagent-ticker-phrase"
            initial={reduced ? false : { y: 8, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 1 } : { y: -8, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="subagent-ticker-name">{item.displayName}</span>
            <span className="subagent-ticker-detail">{item.latestActivity}</span>
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="subagent-ticker-inspect-hint" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
