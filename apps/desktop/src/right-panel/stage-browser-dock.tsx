/**
 * Stage-gutter Browser Mini dock (right workspace collapsed).
 *
 * The mini is the only surface in the stage's right gutter. Tool entry points
 * live in the titlebar panel toggle and the panel's own launcher, so this dock
 * deliberately renders no shortcut rail: the old session-overview card listed
 * Changes / Browser / Terminal / Files a third time and duplicated the
 * titlebar session-status popover.
 *
 * Phone layouts cannot float a window over the transcript: they get the
 * activity chip above the composer instead (spec §7).
 */
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import type { RightPanelTab } from './right-panel-sections';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { BrowserMiniWindow } from '../browser/browser-mini-window';
import { BrowserActivityChip } from '../browser/browser-activity-chip';
import { useSharedBrowserSession } from '../browser/browser-session-provider';
import {
  hasBrowserMiniActivity,
  resolveBrowserMiniTitle,
  resolveBrowserMiniVisibility,
} from '../browser/browser-mini-policy';

export type StageBrowserDockProps = {
  locale: DesktopLocale;
  /** Settings/studio/sub-page covering the stage: the mini must not float over them. */
  overlayOpen: boolean;
  hostReady: boolean;
  onOpenTool: (tab: RightPanelTab) => void;
  onReloadBrowser: () => void;
  /** Where the mini remembers its corner; one bucket per Host. */
  browserMiniPlacementKey?: string;
  phone?: boolean;
};

type MiniPlacement = 'docked' | 'floating';

/** Phone replaces the dock with a chip; isolated so hooks stay unconditional. */
function StagePhoneChip({
  locale,
  title,
  agentDriving,
  onOpen,
}: {
  locale: DesktopLocale;
  title: string;
  agentDriving: boolean;
  onOpen: () => void;
}): ReactElement {
  return (
    <BrowserActivityChip
      locale={locale}
      agentDriving={agentDriving}
      title={title}
      onOpen={onOpen}
    />
  );
}

export function StageBrowserDock(props: StageBrowserDockProps): ReactElement {
  const { locale, onOpenTool } = props;
  const session = useSharedBrowserSession();
  const [miniDismissed, setMiniDismissed] = useState(false);
  const [placement, setPlacement] = useState<MiniPlacement>('docked');

  const activity = {
    url: session?.committedUrl ?? '',
    owner: session?.owner ?? ('idle' as const),
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

  const closeMini = useCallback(() => {
    setMiniDismissed(true);
    setPlacement('docked');
  }, []);

  if (props.phone === true) {
    if (!hasBrowserMiniActivity(activity) || props.overlayOpen) return <></>;
    return (
      <StagePhoneChip
        locale={locale}
        title={miniTitle}
        agentDriving={activity.owner === 'agent'}
        onOpen={() => onOpenTool('browser')}
      />
    );
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
    <div className="stage-browser-dock" data-testid="stage-browser-dock">
      {mini ? <div className="stage-browser-dock-slot">{mini}</div> : null}
    </div>
  );
}
