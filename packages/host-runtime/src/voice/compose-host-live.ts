/** Live composition is independent of Session/Pi runtime construction. */
import { getSessionRecord } from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { loadPiwinConfig } from '../config-store.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { createSecretResolver } from '../secret-resolver.js';
import { LiveCallCoordinator } from './live-call-coordinator.js';
import { composeLiveSettings } from './compose-live-settings.js';
import { composeLiveReviewer } from './compose-live-reviewer.js';
import { readOpenaiCodexLiveAuth } from './codex-live-token.js';
import { createVoiceDelegationAdmission } from './voice-delegation-admission.js';
import { createHostVoiceDelegationPrompt } from './admit-voice-delegation.js';

export function composeHostLive(deps: HostRuntimeKernel): void {
  const piwinRoot = deps.options.piwinRoot;
  const getRecord = (sessionId: string) => getSessionRecord(
    getPiwinSessionIndexPath(getPiwinRoot(piwinRoot)), sessionId,
  );
  const composed = composeLiveSettings({
    ...(piwinRoot === undefined ? {} : { piwinRoot }),
    ...(deps.options.mock === true ? { mock: true } : {}),
    authReady: async () => deps.codexLiveAuthPresent,
    resolveAuth: () => readOpenaiCodexLiveAuth(),
    getCoordinator: () => deps.liveCallCoordinator ?? null,
  });
  deps.liveSettings = composed.service;
  deps.liveCallCoordinator = new LiveCallCoordinator({
    registry: composed.registry,
    resolveSnapshot: (providerId) => composed.service.snapshot(providerId),
    resolveSessionLabel: async (sessionId) => {
      const trimmed = sessionId.trim();
      if (!trimmed) return null;
      try {
        const record = await getRecord(trimmed);
        return record ? record.name?.trim() || trimmed : null;
      } catch {
        console.error('[piwin-live] session lookup failed');
        return null;
      }
    },
    review: deps.options.mock === true
      ? async (request) => ({ kind: 'work', brief: request.instruction })
      : composeLiveReviewer({
          loadConfig: () => loadPiwinConfig(piwinRoot),
          resolveAccounts: async () => await deps.subscriptionAuth?.chatResolveInput() ?? { accounts: [] },
          resolveSessionModel: async (sessionId) => {
            const record = await getRecord(sessionId);
            if (!record) throw new Error('live-session-unavailable');
            return record.model ?? deps.sessionModels.get(sessionId);
          },
          secrets: createSecretResolver(piwinRoot === undefined ? {} : { piwinRoot }),
        }),
    admission: createVoiceDelegationAdmission({
      busy: { isSessionBusy: (sessionId) => Boolean(deps.runRegistry.getForegroundRun(sessionId)) },
      prompt: createHostVoiceDelegationPrompt({ handleCommand: (command) => deps.handleCommand(command) }),
    }),
    ...(deps.options.mock === true ? { getFakeAdapter: () => composed.lastFakeAdapter() } : {}),
    pushUpdated: (call) => deps.push({ type: 'voice/live-updated', call }),
    pushOwnerAction: (action) => deps.push(action),
  });
  deps.liveEnabledFromConfig = true;
  void readOpenaiCodexLiveAuth().then((auth) => {
    deps.codexLiveAuthPresent = auth !== null;
  }).catch(() => console.error('[piwin-live] initial authentication check failed'));
}
