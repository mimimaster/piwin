import type { HostCommand } from '@piwin/contracts';

const LIVE_OWNER_COMMANDS = new Set<HostCommand['type']>([
  'voice/live/start',
  'voice/live/rebind',
  'voice/live/set-muted',
  'voice/live/report-event',
  'voice/live/media-state',
  'voice/live/end',
  'voice/live/apply-settings',
  'voice/live/set-provider-key',
]);

export function isLiveOwnerCommand(type: HostCommand['type']): boolean {
  return LIVE_OWNER_COMMANDS.has(type);
}

/**
 * Live media may be owned by the local anonymous Desktop or by one
 * authenticated paired device (for example the Mobile app). API-token-only
 * remote clients remain observers so a leaked command connection cannot take
 * over a microphone call.
 */
export function isLocalLiveOwnerConnection(input: {
  loopbackHost: boolean;
  pairedDeviceId?: string;
}): boolean {
  return (
    (input.loopbackHost && input.pairedDeviceId === undefined) || input.pairedDeviceId !== undefined
  );
}

/** Name used by new callers; keep the historical export for older tests. */
export const isLiveOwnerConnection = isLocalLiveOwnerConnection;

export function liveOwnerCommandRejectedReason(): string {
  return 'live-not-owner';
}
