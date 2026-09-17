import { IconButton, IconClose, Tabs, TabsList, TabsTrigger } from '@piwin/ui-kit';
import type { DesktopLocale } from './desktop-locale.js';
import { sectionLabel, sectionIcon, type RightPanelTab } from './right-panel-sections.js';

/** Navigation owns its keyboard/focus behavior; surface lifetime stays in
 * RightPanel so switching tabs cannot accidentally close a live terminal. */
export function RightPanelTabs(props: {
  tabs: RightPanelTab[];
  active: RightPanelTab | null;
  locale: DesktopLocale;
  changesCount: number;
  runningJobCount: number;
  cardsDueCount: number | undefined;
  tasksActiveCount: number;
  terminalAttention: boolean;
  /** Overrides the registry label (a docked canvas shows its artifact title). */
  labels?: Partial<Record<RightPanelTab, string>>;
  /** Docked tools carry drop-target geometry for the docking workspace. */
  dockedGroup?: { groupId: string; tabs: readonly RightPanelTab[] };
  onSelect: (tab: RightPanelTab) => void;
  onClose: (tab: RightPanelTab) => void;
}) {
  return (
    <Tabs
      className="right-panel-tabs-root"
      value={props.active ?? ''}
      onValueChange={(value) => {
        const tab = props.tabs.find((candidate) => candidate === value);
        if (tab) props.onSelect(tab);
      }}
    >
      <TabsList
        className="right-panel-tabs"
        label={props.locale === 'zh-CN' ? '工作区工具' : 'Workspace tools'}
      >
        {props.tabs.map((tab) => {
          const active = props.active === tab;
          const label = props.labels?.[tab] ?? sectionLabel(tab, props.locale);
          const dockedIndex = props.dockedGroup?.tabs.indexOf(tab) ?? -1;
          const dockedAttributes =
            props.dockedGroup && dockedIndex >= 0
              ? {
                  'data-docking-right-tab': tab,
                  'data-docking-right-tab-group': props.dockedGroup.groupId,
                  'data-docking-right-tab-index': String(dockedIndex),
                }
              : {};
          const count =
            tab === 'review'
              ? props.changesCount
              : tab === 'terminal'
                ? props.runningJobCount
                : tab === 'cards'
                  ? props.cardsDueCount
                  : tab === 'tasks'
                    ? props.tasksActiveCount
                    : undefined;
          return (
            <div
              key={tab}
              className={`right-panel-tab itab${active ? ' active act' : ''}`}
              {...dockedAttributes}
            >
              <TabsTrigger
                value={tab}
                className="right-panel-tab-main"
                testId={`right-panel-open-tab-${tab}`}
                controlsId={`inspector-panel-${tab}`}
              >
                <span className="right-panel-tab-icon" aria-hidden="true">
                  {sectionIcon(tab)}
                </span>
                <span className="right-panel-tab-label" title={label}>
                  {label}
                </span>
                {count !== undefined && count > 0 ? (
                  <span className="right-panel-tab-badge">{count}</span>
                ) : null}
                {tab === 'terminal' && props.terminalAttention ? (
                  <span className="right-panel-tab-attention att" aria-hidden="true" />
                ) : null}
              </TabsTrigger>
              <IconButton
                className="right-panel-tab-close cx"
                label={props.locale === 'zh-CN' ? `关闭 ${label}` : `Close ${label}`}
                data-testid={`right-panel-close-tab-${tab}`}
                onClick={() => props.onClose(tab)}
              >
                <IconClose width={12} height={12} />
              </IconButton>
            </div>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
