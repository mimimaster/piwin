import type { HostRuntimeKernel } from './host-runtime-kernel.js';

function isSubscriptionSessionModel(
  model: { providerId: string; source?: string },
  providerId: string,
): boolean {
  if (model.providerId !== providerId) {
    return false;
  }
  return model.source === 'subscription' || model.source === undefined;
}

/** Cancel Runs compiled to a subscription provider, then tear down those sessions. */
export async function cancelRunsForSubscriptionProvider(
  deps: HostRuntimeKernel,
  providerId: string,
): Promise<void> {
  const liveCall = deps.liveCallCoordinator?.status({
    capabilities: { microphone: true, mediaDriverIds: ['codex-webrtc-v1', 'gemini-live-v1beta'] },
  }).call;
  if (liveCall?.providerId === providerId) {
    await deps.liveCallCoordinator?.endByHost('logout');
  }
  const sessionIds = [...deps.sessionModels.entries()]
    .filter(([, model]) => isSubscriptionSessionModel(model, providerId))
    .map(([sessionId]) => sessionId);
  const teardownErrors: unknown[] = [];
  for (const sessionId of sessionIds) {
    const runs = deps.runRegistry.list({
      sessionId,
      status: ['queued', 'running', 'cancelling'],
    });
    for (const run of runs) {
      deps.runRegistry.cancelRun(run.runId);
    }
    try {
      const listed = await deps.queuedTurnController.handleCommand(
        { type: 'session/queued-turn-list', sessionId },
        undefined,
      );
      const turns =
        listed !== null &&
        listed.success &&
        listed.data &&
        typeof listed.data === 'object' &&
        'queuedTurns' in listed.data
          ? (
              listed.data as {
                queuedTurns: Array<{ queuedTurnId: string; status: string; revision: number }>;
              }
            ).queuedTurns
          : [];
      for (const turn of turns) {
        if (turn.status !== 'pending' && turn.status !== 'starting') {
          continue;
        }
        await deps.queuedTurnController.handleCommand(
          {
            type: 'session/queued-turn-cancel',
            sessionId,
            queuedTurnId: turn.queuedTurnId,
            expectedRevision: turn.revision,
          },
          undefined,
        );
      }
    } catch {
      // Queued-turn cancel is best-effort; run abort still proceeds.
    }
    try {
      await deps.abortLiveSession(sessionId);
    } catch (error) {
      teardownErrors.push(error);
    }
    try {
      await deps.disposeLiveSession(sessionId, 'host-dispose');
    } catch (error) {
      teardownErrors.push(error);
    }
  }
  if (teardownErrors.length > 0) {
    throw teardownErrors[0];
  }
}
