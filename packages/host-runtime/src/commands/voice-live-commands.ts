/**
 * voice/live/* HostCommand handlers. Coordinator is optional until HostRuntime wires it.
 */

import type {
  HostCommand,
  HostResponse,
  LiveApplySettingsInput,
  LiveSetProviderKeyInput,
  LiveSettingsView,
  LiveStatusData,
} from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';
import type { LiveCallCoordinator } from '../voice/live-call-coordinator.js';

const TYPES = new Set<HostCommand['type']>([
  'voice/live/status',
  'voice/live/settings-schema',
  'voice/live/apply-settings',
  'voice/live/set-provider-key',
  'voice/live/start',
  'voice/live/media-state',
  'voice/live/set-muted',
  'voice/live/end',
  'voice/live/report-event',
]);

export type VoiceLiveCommandContext = HostCommandContext & {
  liveCallCoordinator?: LiveCallCoordinator;
  resolveOwnerDeviceId?: () => string;
  refreshLivePrereqs?: () => Promise<void>;
  liveSettings?: {
    schema(): Promise<LiveSettingsView>;
    apply(
      input: LiveApplySettingsInput,
    ): Promise<{ ok: true; view: LiveSettingsView } | { ok: false; message: string }>;
    setProviderKey(
      input: LiveSetProviderKeyInput,
    ): Promise<{ ok: true; keyConfigured: boolean } | { ok: false; message: string }>;
  };
};

export async function handleVoiceLiveCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: VoiceLiveCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) return null;

  const coordinator = context.liveCallCoordinator;
  if (!coordinator) {
    return fail(requestId, command.type, 'piwin Live is not available on this Host');
  }

  if (command.type === 'voice/live/status') {
    await context.refreshLivePrereqs?.();
    await coordinator.prepare();
    const data: LiveStatusData = coordinator.status(command.input);
    return ok(requestId, command.type, data);
  }

  if (command.type === 'voice/live/settings-schema') {
    const schema = await context.liveSettings?.schema();
    if (!schema) return fail(requestId, command.type, 'live-provider-unavailable');
    return ok(requestId, command.type, schema);
  }

  if (command.type === 'voice/live/apply-settings') {
    const applied = await context.liveSettings?.apply(command.input);
    if (!applied) return fail(requestId, command.type, 'live-provider-unavailable');
    if (!applied.ok) return fail(requestId, command.type, applied.message);
    return ok(requestId, command.type, applied.view);
  }

  if (command.type === 'voice/live/set-provider-key') {
    const result = await context.liveSettings?.setProviderKey(command.input);
    if (!result) return fail(requestId, command.type, 'live-provider-unavailable');
    if (!result.ok) return fail(requestId, command.type, result.message);
    return ok(requestId, command.type, { keyConfigured: result.keyConfigured });
  }

  if (command.type === 'voice/live/start') {
    await context.refreshLivePrereqs?.();
    const ownerDeviceId = context.resolveOwnerDeviceId?.() ?? 'local';
    const result = await coordinator.start({
      sessionId: command.input.sessionId,
      providerId: command.input.providerId,
      settingsRevision: command.input.settingsRevision,
      idempotencyKey: command.input.idempotencyKey,
      bootstrap: command.input.bootstrap,
      ownerDeviceId,
      signal: new AbortController().signal,
    });
    if (!result.ok) {
      return fail(requestId, command.type, result.errorCode);
    }
    const { ok: _ok, ...data } = result;
    return ok(requestId, command.type, data);
  }

  if (command.type === 'voice/live/set-muted') {
    const ownerDeviceId = context.resolveOwnerDeviceId?.() ?? 'local';
    const result = coordinator.setMuted({
      callId: command.input.callId,
      expectedRevision: command.input.expectedRevision,
      muted: command.input.muted,
      ownerDeviceId,
    });
    if (!result.ok) return fail(requestId, command.type, result.errorCode);
    return ok(requestId, command.type, { muted: command.input.muted });
  }

  if (command.type === 'voice/live/end') {
    const ownerDeviceId = context.resolveOwnerDeviceId?.() ?? 'local';
    const result = await coordinator.end({
      ownerDeviceId,
      ...(command.input.callId ? { callId: command.input.callId } : {}),
      ...(command.input.expectedRevision !== undefined
        ? { expectedRevision: command.input.expectedRevision }
        : {}),
    });
    if (!result.ok) return fail(requestId, command.type, result.errorCode);
    return ok(requestId, command.type, { ended: true });
  }

  if (command.type === 'voice/live/media-state') {
    return ok(requestId, command.type, { accepted: true });
  }

  if (command.type === 'voice/live/report-event') {
    const ownerDeviceId = context.resolveOwnerDeviceId?.() ?? 'local';
    const result = coordinator.reportOwnerEvent({
      callId: command.input.callId,
      ownerDeviceId,
      event: command.input.event,
    });
    if (!result.ok) return fail(requestId, command.type, result.errorCode);
    return ok(requestId, command.type, { accepted: true });
  }

  return null;
}
