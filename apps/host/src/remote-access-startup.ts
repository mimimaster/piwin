import { isLegacyAccessMode } from '@piwin/contracts';
import {
  deviceRoleOf,
  type HostDevicePairing,
  type HostDevicePairingFileStore,
  type HostRemoteAccess,
} from '@piwin/host-server';

export type RemoteAccessEnvironment = {
  PIWIN_HOST_RELAY_URL?: string | undefined;
  PIWIN_RELAY_ENROLL_TOKEN?: string | undefined;
  PIWIN_HOST_LEGACY_ACCESS?: string | undefined;
};

/**
 * Applies ADR 0101 settings from the environment of a standalone Host
 * (`PIWIN_HOST_RELAY_URL`, `PIWIN_RELAY_ENROLL_TOKEN`,
 * `PIWIN_HOST_LEGACY_ACCESS`). Returns log lines; invalid values throw so a
 * misconfigured server fails at start instead of running open or offline.
 */
export async function applyRemoteAccessEnvironment(
  access: HostRemoteAccess,
  env: RemoteAccessEnvironment,
): Promise<string[]> {
  const lines: string[] = [];
  const relayUrl = env.PIWIN_HOST_RELAY_URL?.trim();
  const enrollToken = env.PIWIN_RELAY_ENROLL_TOKEN?.trim();
  if (relayUrl !== undefined && relayUrl.length > 0) {
    await access.configure({
      type: 'host/remote-access-configure',
      relay: {
        enabled: true,
        url: relayUrl,
        ...(enrollToken === undefined || enrollToken.length === 0 ? {} : { enrollToken }),
      },
    });
    lines.push(`[piwin-host] relay: ${relayUrl}`);
  }
  const legacy = env.PIWIN_HOST_LEGACY_ACCESS?.trim();
  if (legacy !== undefined && legacy.length > 0) {
    if (!isLegacyAccessMode(legacy)) {
      throw new Error('PIWIN_HOST_LEGACY_ACCESS must be full, migrate-only or off');
    }
    await access.configure({ type: 'host/remote-access-configure', legacyAccess: legacy });
  }
  const status = access.status();
  lines.push(
    `[piwin-host] remote access: host ${status.hostName} (${status.hostId}), user ${status.user?.name ?? '-'} (${status.user?.userId ?? '-'}), legacy ${status.legacyAccess}`,
  );
  return lines;
}

/**
 * ADR 0101 §9 bootstrap: while no operator device exists, mint an operator
 * code and print its v3 link so the owner can pair an administering shell.
 * Undefined when an operator exists or no channel path is reachable yet.
 */
export async function createOperatorPairingAnnouncement(input: {
  pairing: HostDevicePairing;
  store: HostDevicePairingFileStore | undefined;
  access: HostRemoteAccess;
}): Promise<string | undefined> {
  const hasOperator = input.pairing
    .list()
    .some((device) => device.revokedAt === undefined && deviceRoleOf(device) === 'operator');
  if (hasOperator) {
    return undefined;
  }
  const minted = input.pairing.mintToken('operator');
  const links = input.access.channelLinks({
    pairingToken: minted.token,
    expiresAt: minted.expiresAt,
    role: 'operator',
  });
  if (links === undefined) {
    return undefined;
  }
  await input.store?.save(input.pairing);
  return [
    '[piwin-host] operator pairing (one-time, ~10 min): open on the shell that will administer this Host',
    links.channelUri,
    ...(links.webUri === undefined ? [] : [links.webUri]),
  ].join('\n');
}
