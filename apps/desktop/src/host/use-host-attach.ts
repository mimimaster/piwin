/**
 * Connect this window to another Host: by v3 pairing link (ADR 0101 channel),
 * by legacy pairing string, or by address + token. Shared by the boot connect
 * wall and Settings → Connection so both pair the same way and word failures
 * the same way; each caller decides how to show an error. On the phone a
 * camera scan feeds the same paths.
 */
import { useState } from 'react';
import type { PairingLinkV3 } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { classifyPairingInput } from '@piwin/host-client';
import { getDesktopCopy } from '../i18n/desktop-locale.js';
import { useDesktopLocale } from '../i18n/desktop-locale-context.js';
import { getRemoteAccessCopy } from '../i18n/desktop-locale-remote-access.js';
import { probeDesktopRemoteHost } from '../run-activity/probe-desktop-remote-host.js';
import { channelHostDisplayEndpoint, pairWorkbenchChannelHost } from './channel-host-book.js';
import {
  classifyHostConnectFailure,
  describeHostConnectFailure,
  looksLikeBareSocketAddress,
  type HostConnectFailureCopy,
} from './host-connect-failure.js';
import { scanPairingCode } from './pairing-code-scanner.js';
import {
  DESKTOP_HOST_CLIENT_VERSION,
  desktopRemoteClientId,
  type DesktopRemoteHostTarget,
} from './remote-host-session.js';

export type HostAttachOptions = {
  onConnected: (target: DesktopRemoteHostTarget, hostInstanceId?: string) => void;
  onError: (message: string) => void;
};

export type HostAttachActions = {
  busy: boolean;
  connectWithAddress: (input: {
    endpoint: string;
    authToken: string;
    pairingToken?: string;
  }) => Promise<void>;
  pairWithChannelLink: (link: PairingLinkV3) => Promise<void>;
  /** A pasted or scanned link of either generation. */
  pairWithLink: (raw: string) => Promise<void>;
  scanning: boolean;
  /**
   * Opens the camera (mobile shell only) and pairs straight away: a pairing
   * token is single use, so it is never parked in a field to submit later.
   */
  scanAndPair: () => Promise<void>;
};

export function useHostAttach(options: HostAttachOptions): HostAttachActions {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).hostTarget;
  const failureCopy: HostConnectFailureCopy = {
    ...copy,
    channelFailures: getRemoteAccessCopy(locale).channelFailures,
  };
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function connectWithAddress(input: {
    endpoint: string;
    authToken: string;
    pairingToken?: string;
  }): Promise<void> {
    setBusy(true);
    try {
      const result = await probeDesktopRemoteHost({
        endpoint: input.endpoint,
        authToken: input.authToken,
        ...(input.pairingToken === undefined ? {} : { pairingToken: input.pairingToken }),
        invalidEndpointMessage: copy.invalidEndpoint,
      });
      if (!result.ok) {
        options.onError(describeHostConnectFailure(result.failure, failureCopy, input.endpoint));
        return;
      }
      options.onConnected(result.target, result.hostInstanceId);
    } catch (connectError) {
      options.onError(
        describeHostConnectFailure(
          classifyHostConnectFailure(connectError),
          failureCopy,
          input.endpoint,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function pairWithChannelLink(link: PairingLinkV3): Promise<void> {
    setBusy(true);
    try {
      const entry = await pairWorkbenchChannelHost({
        link,
        clientId: desktopRemoteClientId(),
        clientVersion: DESKTOP_HOST_CLIENT_VERSION,
      });
      options.onConnected({ endpoint: channelHostDisplayEndpoint(entry), hostId: entry.hostId });
    } catch (pairError) {
      options.onError(
        describeHostConnectFailure(classifyHostConnectFailure(pairError), failureCopy),
      );
    } finally {
      setBusy(false);
    }
  }

  async function pairWithLink(raw: string): Promise<void> {
    if (looksLikeBareSocketAddress(raw)) {
      options.onError(copy.addressInPairLink);
      return;
    }
    let input: ReturnType<typeof classifyPairingInput>;
    try {
      input = classifyPairingInput(raw);
    } catch (linkError) {
      // The parser's own message names what is wrong with the link.
      options.onError(formatError(linkError));
      return;
    }
    if (input.kind === 'channel') {
      await pairWithChannelLink(input.link);
      return;
    }
    await connectWithAddress({
      endpoint: input.data.endpoint,
      authToken: input.data.authToken ?? '',
      ...(input.data.pairingToken === undefined ? {} : { pairingToken: input.data.pairingToken }),
    });
  }

  async function scanAndPair(): Promise<void> {
    setScanning(true);
    try {
      const scanned = await scanPairingCode();
      if (scanned === undefined) {
        options.onError(copy.scanEmpty);
        return;
      }
      if (scanned.kind === 'channel') {
        await pairWithChannelLink(scanned.link);
        return;
      }
      await connectWithAddress({
        endpoint: scanned.data.endpoint,
        authToken: scanned.data.authToken ?? '',
        ...(scanned.data.pairingToken === undefined
          ? {}
          : { pairingToken: scanned.data.pairingToken }),
      });
    } catch (scanError) {
      options.onError(formatError(scanError));
    } finally {
      setScanning(false);
    }
  }

  return { busy, connectWithAddress, pairWithChannelLink, pairWithLink, scanning, scanAndPair };
}
