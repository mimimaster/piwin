import { useEffect, useState } from 'react';
import {
  resolveDesktopHostResolution,
  saveDesktopHostLaunchMode,
  subscribeDesktopHostLaunchModeChange,
} from './desktop-host-launch';
import { HostConnectWall, HostLaunchChooser } from './host-connect-wall';
import { isDesktopShellOnlyBuild } from './desktop-shell-build';
import {
  clearDesktopRemoteHostTarget,
  saveDesktopRemoteHostTarget,
  subscribeDesktopRemoteHostTargetChange,
} from './remote-host-session';
import {
  loadDesktopLocale,
  saveDesktopLocale,
  type DesktopLocale,
} from './desktop-locale';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { AppWorkbench, type AppProps } from './workbench-app';

export type { AppProps };

/**
 * Boot gate: choose sidecar vs attach before any host_start. Attach without a
 * saved target stays on the connect wall (zero local Host processes).
 */
export function App(props: AppProps) {
  const [locale, setLocale] = useState<DesktopLocale>(() => loadDesktopLocale());
  const [, setGateEpoch] = useState(0);

  useEffect(() => {
    const refresh = (): void => {
      setGateEpoch((current) => current + 1);
    };
    const unsubscribeTarget = subscribeDesktopRemoteHostTargetChange(refresh);
    const unsubscribeLaunch = subscribeDesktopHostLaunchModeChange(refresh);
    return () => {
      unsubscribeTarget();
      unsubscribeLaunch();
    };
  }, []);

  const resolution = resolveDesktopHostResolution();

  if (resolution.kind === 'undecided') {
    return (
      <DesktopLocaleProvider
        locale={locale}
        onLocaleChange={(next) => {
          saveDesktopLocale(next);
          setLocale(next);
        }}
      >
        <HostLaunchChooser
          onChooseSidecar={() => {
            saveDesktopHostLaunchMode('sidecar');
          }}
          onChooseAttach={() => {
            saveDesktopHostLaunchMode('attach');
          }}
        />
      </DesktopLocaleProvider>
    );
  }

  if (resolution.kind === 'attach-wall') {
    return (
      <DesktopLocaleProvider
        locale={locale}
        onLocaleChange={(next) => {
          saveDesktopLocale(next);
          setLocale(next);
        }}
      >
        <HostConnectWall
          allowLocal={!isDesktopShellOnlyBuild()}
          onConnected={(target) => {
            saveDesktopHostLaunchMode('attach');
            saveDesktopRemoteHostTarget(target);
          }}
          {...(isDesktopShellOnlyBuild()
            ? {}
            : {
                onUseLocal: () => {
                  clearDesktopRemoteHostTarget();
                  saveDesktopHostLaunchMode('sidecar');
                },
              })}
        />
      </DesktopLocaleProvider>
    );
  }

  return <AppWorkbench key={resolution.kind} {...props} />;
}
