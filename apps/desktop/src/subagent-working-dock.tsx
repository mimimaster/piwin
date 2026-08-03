/**
 * Collapsed `N Working` launcher + optional expanded active-child list.
 *
 * The dock is a presentational surface fed by the shared activity model; it
 * owns no lifecycle interpretation and opens the same read-only session
 * inspector from every row. Disappears cleanly when the count reaches zero.
 */
import { useState, type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ActiveSubagentView, SubagentInspectorSelection } from './subagent-activity-model';
import { subagentStatusToRunKind, toInspectorSelection } from './subagent-activity-model';
import { ActivitySvgIcon } from './RunActivitySvgIcons.js';
import { SubagentActivityTicker } from './subagent-activity-ticker.js';
import { useDesktopLocale } from './desktop-locale-context';
import { IconChevronDown } from './shell-icons.js';

const STATUS_LABEL: Record<ActiveSubagentView['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export type SubagentWorkingDockProps = {
  items: ActiveSubagentView[];
  onInspect: (selection: SubagentInspectorSelection) => void;
};

export function SubagentWorkingDock(props: SubagentWorkingDockProps): ReactElement | null {
  if (props.items.length === 0) {
    return null;
  }
  return <SubagentWorkingDockContent {...props} />;
}

function SubagentWorkingDockContent(props: SubagentWorkingDockProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const count = props.items.length;
  const label = isChinese
    ? `${count} 个 Agent 工作中`
    : `${count} subagent${count === 1 ? '' : 's'} working`;

  return (
    <div
      className="subagent-working-dock"
      data-expanded={expanded}
      data-count={count}
      data-testid="subagent-working-dock"
    >
      <button
        type="button"
        className="subagent-working-dock-header"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <span className="subagent-working-dot" aria-hidden="true" />
        <span className="subagent-working-label">{label}</span>
        <IconChevronDown
          className="subagent-working-chevron"
          width={12}
          height={12}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.ul
            key="subagent-working-list"
            className="subagent-working-list"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 1 } : { height: 0, opacity: 0 }}
            transition={
              reduced ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
            }
          >
            {props.items.map((item) => (
              <li key={item.childSessionId}>
                <button
                  type="button"
                  className="subagent-working-row"
                  data-testid="subagent-working-row"
                  data-child-session-id={item.childSessionId}
                  onClick={() => props.onInspect(toInspectorSelection(item))}
                  title={item.taskSummary}
                >
                  <ActivitySvgIcon
                    kind={subagentStatusToRunKind(item.status)}
                    className="subagent-status-icon"
                  />
                  <span className="subagent-working-row-name">{item.displayName}</span>
                  <span className="subagent-working-row-task muted">{item.taskSummary}</span>
                  <span className={`subagent-working-row-state state-${item.status}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        ) : (
          <SubagentActivityTicker key="subagent-activity-ticker" {...props} />
        )}
      </AnimatePresence>
    </div>
  );
}
