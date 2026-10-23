import { useMemo, type ReactElement } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useRunActivityPhrases } from './run-activity-hooks.js';
import { resolveActivityIcon } from './run-activity-icon.js';
import { RunActivityIcon } from './RunActivityIcon.js';
import type { RunActivityInput, ActivityActionCategory } from './run-activity-types.js';

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

function resolveKindBadge(input: RunActivityInput, category?: ActivityActionCategory): string {
  if (category === 'terminal') {
    return input.locale === 'zh-CN' ? '执行 Command' : (input.activeToolName ? input.activeToolName.toUpperCase() : 'TERMINAL');
  }
  if (category === 'edit') {
    return input.locale === 'zh-CN' ? '编辑代码' : (input.activeToolName ? input.activeToolName.toUpperCase() : 'EDIT');
  }
  if (category === 'search') {
    return input.locale === 'zh-CN' ? '检索代码' : (input.activeToolName ? input.activeToolName.toUpperCase() : 'SEARCH');
  }
  if (category === 'web') {
    return input.locale === 'zh-CN' ? '网页搜索' : (input.activeToolName ? input.activeToolName.toUpperCase() : 'WEB');
  }
  if (category === 'subagent') {
    return input.locale === 'zh-CN' ? '子Agent 协作' : 'SUBAGENT';
  }

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
  const badgeLabel = resolveKindBadge(props.input, iconSource.actionCategory);

  return (
    <div
      className="run-activity-splash"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={ariaLabel}
      data-kind={props.input.kind}
      {...(iconSource.actionCategory ? { 'data-action': iconSource.actionCategory } : {})}
    >
      <span className="sr-only">{ariaLabel}</span>
      <div
        className="run-activity-splash-icon-wrap"
        data-kind={props.input.kind}
        {...(iconSource.actionCategory ? { 'data-action': iconSource.actionCategory } : {})}
      >
        <div className="run-activity-splash-glow" aria-hidden="true" />
        <RunActivityIcon source={iconSource} className="run-activity-splash-icon" />
      </div>
      <div className="run-activity-splash-content">
        <div className="run-activity-splash-meta">
          <span
            className="run-activity-badge"
            data-kind={props.input.kind}
            {...(iconSource.actionCategory ? { 'data-action': iconSource.actionCategory } : {})}
          >
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
                initial={reduced ? false : { y: 10, opacity: 0, scale: 0.98, filter: 'blur(3px)' }}
                animate={
                  reduced
                    ? { opacity: 1 }
                    : { y: 0, opacity: 1, scale: 1, filter: 'blur(0px)' }
                }
                exit={
                  reduced
                    ? { opacity: 1 }
                    : { y: -10, opacity: 0, scale: 0.98, filter: 'blur(3px)' }
                }
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }
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

