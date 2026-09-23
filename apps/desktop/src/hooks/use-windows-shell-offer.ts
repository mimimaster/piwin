import { useCallback, useEffect, useState } from 'react';
import type { PiwinConfig } from '@piwin/contracts';

import type { HostClient } from '../host-client';
import type { HostRequestAdapters } from '../host-request-adapters';
import { isWindowsDesktopPlatform } from '../window-chrome';
import { shouldOfferGitBash } from '../windows-shell-offer';

/**
 * Whether this Windows Host can run the `bash` tool as bash at all.
 * `undefined` means "no answer": a non-Windows Host, or a Host old enough not
 * to know the query. Callers must not read that as "Git Bash is missing".
 */
async function readGitBashInstallation(hostClient: HostClient): Promise<boolean | undefined> {
  const response = await hostClient.request({ type: 'host/shell-environment' });
  if (!response.success) {
    return undefined;
  }
  const data = response.data as { platform?: string; gitBashInstalled?: boolean };
  if (data.platform !== 'win32') {
    return undefined;
  }
  return data.gitBashInstalled === true;
}

/**
 * One-time offer to install Git Bash on Windows, where the tool named `bash`
 * otherwise falls back to PowerShell.
 *
 * The shell itself is never configured: detection runs on every launch, so
 * clicking "I installed it" needs no bookkeeping and installing Git Bash by any
 * other route works just as well. Declining records only that we asked, so the
 * user is not asked again.
 */
export function useWindowsShellOffer(args: {
  hostClient: HostClient;
  config: PiwinConfig | null;
  requestConfig: HostRequestAdapters['requestConfig'];
}): {
  offer: boolean;
  useGitBash: () => void;
  declineGitBash: () => void;
} {
  const { hostClient, config, requestConfig } = args;
  // Assume installed until the Host answers: guessing "missing" would offer a
  // download to someone who already has Git Bash.
  const [gitBashInstalled, setGitBashInstalled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void readGitBashInstallation(hostClient).then((installed) => {
      if (!cancelled && installed !== undefined) {
        setGitBashInstalled(installed);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hostClient]);

  const useGitBash = useCallback(() => {
    // Re-probe: the user confirms after installing. Nothing is written — the
    // offer simply retires when detection sees the real thing.
    void readGitBashInstallation(hostClient).then((installed) => {
      if (installed === true) {
        setGitBashInstalled(true);
      }
    });
  }, [hostClient]);

  const declineGitBash = useCallback(() => {
    if (!config) {
      return;
    }
    void requestConfig({
      type: 'config/set',
      config: { ...config, shell: { windowsBashOfferDeclined: true } },
    });
  }, [config, requestConfig]);

  const offer =
    config !== null &&
    shouldOfferGitBash({
      windows: isWindowsDesktopPlatform(navigator.platform ?? '', navigator.userAgent ?? ''),
      offerDeclined: config.shell?.windowsBashOfferDeclined === true,
      gitBashInstalled,
    });

  return { offer, useGitBash, declineGitBash };
}
