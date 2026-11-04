/**
 * Stage-gutter Session Rail: the collapsed right workspace's only entry point.
 *
 * One product surface with three states — collapsed rail, expanded Summary,
 * expanded tool — replaces the old four-shortcut card, so Summary and every
 * tool keep a stable entry even when the gutter narrows. The rail also hosts
 * the Browser Mini: a live view of the one shared browser, docked under the
 * rail until the user drags it away.
 */
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { SessionRail, type SessionRailItemProps } from '@piwin/ui-kit';
import type { RightPanelTab } from './right-panel-sections';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { sectionIcon } from './right-panel-sections';
import { IconActivity } from '../tool-cards/shell-icons';
import { BrowserMiniWindow } from '../browser/browser-mini-window';
import { BrowserActivityChip } from '../browser/browser-activity-chip';
import { useSharedBrowserSession } from '../browser/browser-session-provider';
import {
  hasBrowserMiniActivity,
  resolveBrowserMiniTitle,
  resolveBrowserMiniVisibility,
} from '../browser/browser-mini-policy';

export type SessionRailDockProps = {
  locale: DesktopLocale;
  /** Working-tree size; null outside a project with no git. */
  diffStat: { additions: number; deletions: number } | null;
  tasksActiveCount: number;
  runningJobCount: number;
  /** Settings/studio/sub-page covering the stage: the mini must not float over them. */
  overlayOpen: boolean;
  hostReady: boolean;
  onOpenTool: (tab: RightPanelTab) => void;
  onReloadBrowser: () => void;
  /** Where the mini remembers its corner; one bucket per Host. */
  browserMiniPlacementKey?: string;
  /**
   * Phone layouts cannot float a window over the transcript: they get the
   * activity chip above the composer instead (spec §7).
   */
  phone?: boolean;
};

type MiniPlacement = 'docked' | 'floating';

export function SessionRailDock(props: SessionRailDockProps): ReactElement {
  const { locale, onOpenTool } = props;
  const zh = locale === 'zh-CN';
  const session = useSharedBrowserSession();
  const [miniDismissed, setMiniDismissed] = useState(false);
  const [placement, setPlacement] = useState<MiniPlacement>('docked');

  const activity = {
    url: session?.committedUrl ?? '',
    owner: session?.owner ?? ('idle' as const),
    frameSrc: session?.frame.src ?? '',
  };
  const miniVisibility = resolveBrowserMiniVisibility({
    rightBodyOpen: false,
    overlayOpen: props.overlayOpen,
    phone: props.phone === true,
    dismissed: miniDismissed,
    activity,
  });
  const showMini = miniVisibility.visible;
  const miniTitle = resolveBrowserMiniTitle({
    title: session?.title ?? '',
    url: activity.url,
    fallback: '',
  });

  // The chip replaces rail+mini on phone; the rail is desktop/tablet chrome.
  if (props.phone === true) {
    if (!hasBrowserMiniActivity(activity) || props.overlayOpen) return <></>;
    return (
      <BrowserActivityChip
        locale={locale}
        agentDriving={activity.owner === 'agent'}
        title={miniTitle}
        onOpen={() => onOpenTool('browser')}
      />
    );
  }

  const closeMini = useCallback(() => {
    setMiniDismissed(true);
    setPlacement('docked');
  }, []);

  const items: SessionRailItemProps[] = [
    {
      id: 'summary',
      label: zh ? '会话概览' : 'Summary',
      icon: <IconActivity />,
      variant: 'summary',
      onSelect: () => onOpenTool('summary'),
    },
    {
      id: 'review',
      label: zh ? '变更' : 'Changes',
      icon: sectionIcon('review'),
      ...(props.diffStat === null ? {} : { diffStat: props.diffStat }),
      onSelect: () => onOpenTool('review'),
    },
    {
      id: 'browser',
      label: zh ? '浏览器' : 'Browser',
      icon: sectionIcon('browser'),
      ...(session?.owner === 'agent'
        ? { statusTone: 'running' as const, badgeText: zh ? 'AI 操作中' : 'Agent' }
        : showMini
          ? { statusTone: 'success' as const }
          : {}),
      onSelect: () => onOpenTool('browser'),
    },
    {
      id: 'terminal',
      label: zh ? '终端' : 'Terminal',
      icon: sectionIcon('terminal'),
      ...(props.runningJobCount > 0
        ? { badgeText: zh ? `${String(props.runningJobCount)} 运行中` : `${String(props.runningJobCount)} running` }
        : {}),
      onSelect: () => onOpenTool('terminal'),
    },
    {
      id: 'files',
      label: zh ? '文件' : 'Files',
      icon: sectionIcon('files'),
      onSelect: () => onOpenTool('files'),
    },
  ];

  if (props.tasksActiveCount > 0) {
    items.push({
      id: 'tasks',
      label: zh ? '任务' : 'Tasks',
      icon: sectionIcon('tasks'),
      variant: 'activity',
      badgeText: String(props.tasksActiveCount),
      onSelect: () => onOpenTool('tasks'),
    });
  }

  // Kept mounted across the docked → floating switch: re-mounting would lose
  // the drag origin and the pointer capture mid-gesture.
  const mini: ReactNode = showMini ? (
    <BrowserMiniWindow
      locale={locale}
      hostReady={props.hostReady}
      placement={placement}
      onExpand={() => onOpenTool('browser')}
      onDismiss={closeMini}
      onStartFloating={() => setPlacement('floating')}
      onSnapBack={() => setPlacement('docked')}
      onReload={props.onReloadBrowser}
      placementKey={props.browserMiniPlacementKey ?? 'local'}
    />
  ) : null;

  return (
    <div className="stage-tool-dock" data-testid="session-rail-dock">
      <div className="stage-session-rail">
        <SessionRail
          density="auto"
          ariaLabel={zh ? '会话工具导轨' : 'Session tools'}
          items={items}
          {...(showMini ? { dockedSlot: mini } : {})}
        />
      </div>
    </div>
  );
}
