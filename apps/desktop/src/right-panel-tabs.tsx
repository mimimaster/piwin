import { useEffect, useRef } from 'react';
import { IconButton, IconClose, Tabs, TabsList, TabsTrigger } from '@piwin/ui-kit';
import type { DesktopLocale } from './desktop-locale.js';
import {
  sectionLabel,
  sectionIcon,
  isTerminalTab,
  rightPanelTabKind,
  type RightPanelTab,
} from './right-panel-sections.js';

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
  /** Overrides the registry label (a docked canvas shows its artifact title). */
  labels?: Partial<Record<RightPanelTab, string>>;
  /** Docked tools carry drop-target geometry for the docking workspace. */
  dockedGroup?: { groupId: string; tabs: readonly RightPanelTab[] };
  onSelect: (tab: RightPanelTab) => void;
  onClose: (tab: RightPanelTab) => void;
}) {
  // The strip scrolls without a scrollbar, so a tab activated from elsewhere
  // (shortcut, agent reveal) has to bring itself into view.
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Optional call: test DOMs may not implement scrollIntoView.
    activeTabRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [props.active, props.tabs.length]);

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
          const kind = rightPanelTabKind(tab);
          // Counts belong to the tool, so only the first instance wears the badge.
          const count =
            tab === 'review'
              ? props.changesCount
              : isTerminalTab(tab)
                ? undefined
                : tab === 'cards'
                  ? props.cardsDueCount
                  : tab === 'tasks'
                    ? props.tasksActiveCount
                    : undefined;
          return (
            <div
              key={tab}
              ref={active ? activeTabRef : null}
              className={`right-panel-tab itab${active ? ' active act' : ''}`}
              data-right-panel-kind={kind ?? undefined}
              {...dockedAttributes}
              // Middle click closes, as in a browser; mousedown is cancelled so
              // the webview does not start its autoscroll instead.
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                props.onClose(tab);
              }}
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
