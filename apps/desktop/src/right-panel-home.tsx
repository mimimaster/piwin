/**
 * Empty-state launcher for the right panel.
 */

import { type ReactElement } from 'react';
import { SECTION_META, isHomeLauncherSection, sectionLabel } from './right-panel-sections';
import type { DesktopLocale } from './desktop-locale';
import type { RightPanelTab } from './right-panel-sections';

export type RightPanelHomeProps = {
  locale: DesktopLocale;
  onSelect: (tab: RightPanelTab) => void;
  tasksActiveCount?: number;
};

export function RightPanelHome(props: RightPanelHomeProps): ReactElement {
  return (
    <div className="right-panel-home blank-tool" data-testid="right-panel-home">
      <div className="right-panel-home-list" role="list">
        {SECTION_META.filter(isHomeLauncherSection).map((tab) => {
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
