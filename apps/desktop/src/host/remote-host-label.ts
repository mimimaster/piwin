import { useSyncExternalStore } from 'react';
import { getRemoteAccessCopy } from '../i18n/desktop-locale-remote-access.js';
import { useDesktopLocale } from '../i18n/desktop-locale-context.js';
import { peekChannelHost } from './channel-host-book.js';
import { readChannelPath, subscribeChannelPath } from './channel-path-store.js';
import {
  formatDesktopRemoteHostDisplay,
  type DesktopRemoteHostTarget,
} from './remote-host-session.js';

/**
 * A person-facing name for the attached Host: the host book name (or alias)
 * for a channel Host — its endpoint is the relay, not the Host — else the
 * legacy address.
 */
export function describeDesktopRemoteHostName(
  target: DesktopRemoteHostTarget | undefined,
): string | undefined {
  if (target === undefined) return undefined;
  if (target.hostId !== undefined) {
    const entry = peekChannelHost(target.hostId)?.entry;
    if (entry !== undefined) return entry.alias ?? entry.hostName;
  }
  return formatDesktopRemoteHostDisplay(target.endpoint);
}

/** Runtime chip label: `MacBook · relay` while a channel path is open. */
export function useRuntimeRemoteHostLabel(hostClient: {
  getTransport(): string;
  getRemoteTarget(): DesktopRemoteHostTarget | undefined;
}): string | undefined {
  const { locale } = useDesktopLocale();
  const target = hostClient.getTransport() === 'remote' ? hostClient.getRemoteTarget() : undefined;
  const hostId = target?.hostId;
  const path = useSyncExternalStore(subscribeChannelPath, () =>
    hostId === undefined ? undefined : readChannelPath(hostId),
  );
  const name = describeDesktopRemoteHostName(target);
  if (name === undefined || path === undefined) return name;
  const copy = getRemoteAccessCopy(locale);
  return `${name} · ${path === 'relay' ? copy.pathRelay : copy.pathDirect}`;
}
