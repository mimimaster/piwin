import { useMemo, type ReactElement } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useRunActivityPhrases } from './run-activity-hooks.js';
import { resolveActivityIcon } from './run-activity-icon.js';
import { RunActivityIcon } from './RunActivityIcon.js';
import type { RunActivityInput } from './run-activity-types.js';

export type RunActivitySplashProps = {
  input: RunActivityInput;
};

export function RunActivitySplash(props: RunActivitySplashProps): ReactElement {
  const reduced = useReducedMotion() ?? false;
  const { phrases, currentPhrase } = useRunActivityPhrases(props.input);
  const iconSource = useMemo(() => resolveActivityIcon(props.input), [props.input]);
  const ariaLabel = phrases[0] ?? '';

  return (
    <div
      className="run-activity-splash"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={ariaLabel}
      data-kind={props.input.kind}
    >
      <span className="sr-only">{ariaLabel}</span>
      <div className="run-activity-splash-icon-wrap" data-kind={props.input.kind}>
        <RunActivityIcon source={iconSource} className="run-activity-splash-icon" />
      </div>
      <div className="run-activity-splash-text" aria-hidden>
        <span className="run-activity-splash-label">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={currentPhrase}
              className="run-activity-splash-phrase"
              initial={reduced ? false : { y: 14, opacity: 0, filter: 'blur(4px)' }}
              animate={
                reduced
                  ? { opacity: 1 }
                  : { y: 0, opacity: 1, filter: 'blur(0px)' }
              }
              exit={
                reduced
                  ? { opacity: 1 }
                  : { y: -14, opacity: 0, filter: 'blur(4px)' }
              }
              transition={
                reduced
                  ? { duration: 0 }
                  : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }
              }
            >
              {currentPhrase}
            </motion.span>
          </AnimatePresence>
        </span>
      </div>
    </div>
  );
}
