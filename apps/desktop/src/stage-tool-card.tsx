/**
 * Idle-state tool rail floating in the stage's right gutter while the right
 * panel is closed: Changes (with working-tree size), Browser, Terminal, Files.
 * Opening a tool opens the panel, which hides the rail.
 *
 * The dock is a pointer-transparent layer spanning the stage so the rail can
 * size itself to the gutter (labels → icons → hidden) in every theme.
 */
import type { ReactElement } from 'react';
import type { HostResponse } from '@piwin/contracts';
import type { DesktopLocale } from './desktop-locale';
import { sectionIcon, sectionLabel, type RightPanelTab } from './right-panel-sections';
import { useWorkingTreeStat, type WorkingTreeStatRequest } from './use-working-tree-stat';

const CARD_TOOLS = ['review', 'browser', 'terminal', 'files'] as const satisfies readonly RightPanelTab[];

function toolLabel(tab: (typeof CARD_TOOLS)[number], locale: DesktopLocale): string {
  if (tab === 'terminal') return locale === 'zh-CN' ? '终端' : 'Terminal';
  return sectionLabel(tab, locale);
}

export type StageToolCardProps = {
  locale: DesktopLocale;
  /** null outside a project: no Changes stat. */
  projectPath: string | null;
  request: (command: WorkingTreeStatRequest) => Promise<HostResponse>;
  onOpenTool: (tab: RightPanelTab) => void;
};

export function StageToolCard(props: StageToolCardProps): ReactElement {
  const stat = useWorkingTreeStat(props.projectPath, props.request);
  return (
    <div className="stage-tool-dock">
      <nav
        className="stage-tool-card"
        data-testid="stage-tool-card"
        aria-label={props.locale === 'zh-CN' ? '工具' : 'Tools'}
      >
        {CARD_TOOLS.map((tab) => {
          const label = toolLabel(tab, props.locale);
          const showStat = tab === 'review' && stat !== null;
          return (
            <button
              key={tab}
              type="button"
              className="stage-tool-card-row"
              data-testid={`stage-tool-card-${tab}`}
              title={showStat ? `${label} +${stat.additions} −${stat.deletions}` : label}
              aria-label={label}
              onClick={() => props.onOpenTool(tab)}
            >
              <span className="stage-tool-card-icon" aria-hidden>
                {sectionIcon(tab)}
                {showStat ? <span className="stage-tool-card-dot" /> : null}
              </span>
              <span className="stage-tool-card-label">{label}</span>
              {showStat ? (
                <span className="stage-tool-card-stat" data-testid="stage-tool-card-stat">
                  <span className="stage-tool-card-add">+{stat.additions}</span>
                  <span className="stage-tool-card-del">−{stat.deletions}</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
