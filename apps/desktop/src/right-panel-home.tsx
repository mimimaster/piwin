/**
 * Empty-state launcher for the right panel.
 */

import { type ReactElement } from 'react';
import { SECTION_META, isHomeLauncherSection, sectionLabel } from './right-panel-sections';
import { RightPanelHomeEnvironment } from './right-panel-home-environment';
import { useHomeGitSummary, type RightPanelHomeContext } from './right-panel-home-context';
import type { DesktopLocale } from './desktop-locale';
import type { RightPanelToolKind } from './right-panel-sections';

export type RightPanelHomeProps = {
  locale: DesktopLocale;
  onSelect: (kind: RightPanelToolKind) => void;
  tasksActiveCount?: number;
  /** The launcher is on screen (panel open); gates the git fetch. */
  active?: boolean;
  context?: RightPanelHomeContext | undefined;
};

export function RightPanelHome(props: RightPanelHomeProps): ReactElement {
  const git = useHomeGitSummary(props.context, props.active === true);
  const changes = git?.changes;
  const shownStat = changes && changes.additions + changes.deletions > 0 ? changes : null;
  return (
    <div className="right-panel-home blank-tool" data-testid="right-panel-home">
      <div className="right-panel-home-list" role="list">
        {props.context ? (
          <RightPanelHomeEnvironment
            locale={props.locale}
            context={props.context}
            branch={git?.branch ?? null}
          />
        ) : null}
        {SECTION_META.filter((entry) => isHomeLauncherSection(entry)).map((tab) => {
          const label = sectionLabel(tab.id, props.locale);
          return (
            <button
              key={tab.id}
              type="button"
              className="right-panel-home-row home-tile"
              data-testid={`right-panel-home-${tab.id}`}
              aria-label={label}
              onClick={() => props.onSelect(tab.id)}
            >
              <span className="right-panel-home-row-left">
                <span className="right-panel-home-icon" aria-hidden>
                  {tab.icon}
                </span>
                <span className="right-panel-home-label">{label}</span>
                {tab.id === 'review' && shownStat ? (
                  <span className="right-panel-home-diffstat" data-testid="right-panel-home-diffstat">
                    <span className="right-panel-home-diffstat-add">+{shownStat.additions}</span>
                    <span className="right-panel-home-diffstat-del">−{shownStat.deletions}</span>
                  </span>
                ) : null}
              </span>
              {tab.id === 'tasks' && (props.tasksActiveCount ?? 0) > 0 ? (
                <span className="right-panel-tab-badge" data-testid="right-panel-home-tasks-badge">
                  {props.tasksActiveCount}
                </span>
              ) : tab.shortcut ? (
                <kbd className="right-panel-home-shortcut" aria-hidden>
                  {tab.shortcut}
                </kbd>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
