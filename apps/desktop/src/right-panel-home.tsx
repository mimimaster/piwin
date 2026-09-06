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
};

export function RightPanelHome(props: RightPanelHomeProps): ReactElement {
  const heading =
    props.locale === 'zh-CN' ? '为这次对话添一件工具' : 'Add a tool to this conversation';
  return (
    <div className="right-panel-home blank-tool" data-testid="right-panel-home">
      <span className="eyebrow">YOUR WORKSPACE</span>
      <h3>{heading}</h3>
      <div className="right-panel-home-grid home-grid" role="list">
        {SECTION_META.filter(isHomeLauncherSection).map((tab) => {
          const label = sectionLabel(tab.id, props.locale);
          return (
            <button
              key={tab.id}
              type="button"
              className="right-panel-home-tile home-tile"
              data-testid={`right-panel-home-${tab.id}`}
              aria-label={label}
              onClick={() => props.onSelect(tab.id)}
            >
              <span className="right-panel-home-icon" aria-hidden>
                {tab.icon}
              </span>
              <span className="right-panel-home-label">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
