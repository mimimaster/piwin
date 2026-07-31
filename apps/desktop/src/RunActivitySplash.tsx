import { useMemo, type ReactElement } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useRunActivityPhrases } from './run-activity-hooks.js';
import { resolveActivityIcon } from './run-activity-icon.js';
import { RunActivityIcon } from './RunActivityIcon.js';
import type { RunActivityInput } from './run-activity-types.js';

export type RunActivitySplashProps = {
  input: RunActivityInput;
};

function formatElapsedSeconds(ms?: number): string | null {
  if (typeof ms !== 'number' || ms <= 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function resolveKindBadge(input: RunActivityInput): string {
  switch (input.kind) {
    case 'connecting-model':
      return input.locale === 'zh-CN' ? '连接模型' : 'CONNECTING';
    case 'waiting-first-token':
      return input.locale === 'zh-CN' ? '思考中' : 'THINKING';
    case 'planning':
      return input.locale === 'zh-CN' ? '规划中' : 'PLANNING';
    case 'working':
      if (input.activeToolName) {
        return input.activeToolName.toUpperCase();
      }
      return input.locale === 'zh-CN' ? '执行中' : 'WORKING';
    case 'waiting-permission':
      return input.locale === 'zh-CN' ? '等待授权' : 'PERMISSION';
    case 'compacting':
      return input.locale === 'zh-CN' ? '压缩记忆' : 'COMPACTING';
    case 'stopping':
      return input.locale === 'zh-CN' ? '中断中' : 'STOPPING';
    case 'failed':
      return input.locale === 'zh-CN' ? '异常' : 'FAILED';
    case 'complete':
      return input.locale === 'zh-CN' ? '完成' : 'COMPLETE';
    default:
      return 'AI';
  }
}

export function RunActivitySplash(props: RunActivitySplashProps): ReactElement {
  const reduced = useReducedMotion() ?? false;
  const { phrases, currentPhrase } = useRunActivityPhrases(props.input);
  const iconSource = useMemo(() => resolveActivityIcon(props.input), [props.input]);
  const ariaLabel = phrases[0] ?? '';
  const elapsedText = formatElapsedSeconds(props.input.elapsedMs);
  const badgeLabel = resolveKindBadge(props.input);

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
        <div className="run-activity-splash-glow" aria-hidden="true" />
        <RunActivityIcon source={iconSource} className="run-activity-splash-icon" />
      </div>
      <div className="run-activity-splash-content">
        <div className="run-activity-splash-meta">
          <span className="run-activity-badge" data-kind={props.input.kind}>
            {badgeLabel}
          </span>
          {elapsedText ? <span className="run-activity-timer-pill">{elapsedText}</span> : null}
        </div>
        <div className="run-activity-splash-text" aria-hidden>
          <span className="run-activity-splash-label">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={currentPhrase}
                className="run-activity-splash-phrase"
                initial={reduced ? false : { y: 12, opacity: 0, filter: 'blur(4px)' }}
                animate={
                  reduced
                    ? { opacity: 1 }
                    : { y: 0, opacity: 1, filter: 'blur(0px)' }
                }
                exit={
                  reduced
                    ? { opacity: 1 }
                    : { y: -12, opacity: 0, filter: 'blur(4px)' }
                }
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
                }
              >
                {currentPhrase}
              </motion.span>
            </AnimatePresence>
          </span>
        </div>
      </div>
    </div>
  );
}
