import { type ReactElement } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useRunActivityPhrases } from './run-activity-hooks.js';
import { resolveActivityIcon } from './run-activity-icon.js';
import { RunActivityIcon } from './RunActivityIcon.js';
import { runStatusToActivityInput } from './run-activity-mappers.js';
import type { RunStatusView } from './run-status.js';

export type RunActivityInlineProps = {
  runState: RunStatusView;
  locale?: 'zh-CN' | 'en';
};

export function RunActivityInline(props: RunActivityInlineProps): ReactElement | null {
  if (props.runState.kind === 'idle') {
    return null;
  }
  return <RunActivityInlineContent {...props} />;
}

function formatShortElapsed(ms?: number): string | null {
  if (typeof ms !== 'number' || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  return `${s}s`;
}

function RunActivityInlineContent(props: RunActivityInlineProps): ReactElement {
  const reduced = useReducedMotion() ?? false;
  const locale = props.locale ?? 'zh-CN';
  const input = runStatusToActivityInput(props.runState, locale);
  const { phrases, currentPhrase } = useRunActivityPhrases(input);
  const iconSource = resolveActivityIcon(input);
  const durationTag = formatShortElapsed(input.elapsedMs);

  return (
    <span className="run-activity-inline" data-kind={input.kind}>
      <span className="sr-only">{phrases[0] ?? ''}</span>
      <span className="run-activity-inline-icon-wrap" data-kind={input.kind}>
        <RunActivityIcon source={iconSource} className="run-activity-inline-icon" />
      </span>
      <span className="run-activity-inline-label" aria-hidden>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={currentPhrase}
            className="run-activity-inline-phrase"
            initial={reduced ? false : { y: 8, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 1 } : { y: -8, opacity: 0 }}
            transition={
              reduced
                ? { duration: 0 }
                : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }
            }
          >
            {currentPhrase}
          </motion.span>
        </AnimatePresence>
      </span>
      {durationTag ? <span className="run-activity-inline-timer">{durationTag}</span> : null}
    </span>
  );
}
