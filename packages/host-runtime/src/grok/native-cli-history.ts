import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { getSessionRecord, updateSessionRecord } from '@piwin/session';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { workingDirectoryFromIndexRecord } from '../session-scope.js';
import { rebuildTranscriptFromReplay } from './grok-transcript-replay.js';
import { AgentCliError } from './native-cli-error.js';
import { applyExternalAgentMetadata } from './grok-catalog-sync.js';

/** Native view sync is a data read, never a writer handoff or a new agent process. */
export async function snapshotNativeCliHistory(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<void> {
  // An already-running Host turn owns its up-to-date transcript projection.
  if (deps.runRegistry.getForegroundRun(sessionId) !== undefined) return;
  if (!deps.sessionBodyGate.tryReserve(sessionId))
    throw new AgentCliError('writer-busy', 'session body is busy');
  try {
    const indexPath = getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot));
    const record = await getSessionRecord(indexPath, sessionId);
    const binding = record?.backend;
    if (
      record === undefined ||
      binding?.backendSessionId === undefined ||
      deps.externalAgents === undefined
    ) {
      throw new AgentCliError('session-unavailable', 'native session is unavailable');
    }
    const snapshotStartedAt = Date.now();
    const observed = await deps.externalAgents.observeNativeSession(
      binding.agentId,
      {
        backendSessionId: binding.backendSessionId,
        workingDirectory: workingDirectoryFromIndexRecord(record, deps.options.piwinRoot),
        includeHistory: true,
      },
      sessionId,
    );
    if (observed === undefined || observed.replayEvents === undefined) {
      throw new AgentCliError(
        'cli-unsupported',
        'update the agent extension to support native history snapshots',
      );
    }
    const latest = await getSessionRecord(indexPath, sessionId);
    if (latest?.backend?.backendSessionId !== binding.backendSessionId)
      throw new AgentCliError('transition-failed', 'native binding changed');
    await rebuildTranscriptFromReplay(
      deps,
      record,
      observed.replayEvents.map((emission) => emission.event),
      undefined,
    );
    await applyExternalAgentMetadata(deps, sessionId, observed);
    await updateSessionRecord(indexPath, sessionId, (current) => {
      if (
        current.backend !== undefined &&
        current.backend.backendSessionId === binding.backendSessionId
      )
        current.backend.syncedChangeUnixMs = observed.lastChangeUnixMs ?? snapshotStartedAt;
    });
    deps.agentCliOwnership?.setNativeActivity(sessionId, observed.activity);
  } finally {
    deps.sessionBodyGate.release(sessionId);
  }
}
