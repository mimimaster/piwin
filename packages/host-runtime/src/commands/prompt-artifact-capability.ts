import type { PiwinConfig, ResolvedArtifactCapability } from '@piwin/contracts';
import { getSessionRecord } from '@piwin/session';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import {
  artifactScopeKeyForIndexRecord,
  resolveGenerationArtifactCapability,
} from '../session-scope.js';
import type { SessionLiveContext } from './session-live-context.js';

/**
 * Artifact capability for the prompt path. The scope class comes from the same
 * durable record the compiler uses, so an Agent chat session with Artifacts off
 * never receives the advisory Inline/theme block. An unreadable record leaves
 * the capability unresolved and the hint is dropped rather than guessed.
 */
export async function resolvePromptArtifactCapability(
  context: Pick<SessionLiveContext, 'piwinRoot'>,
  sessionId: string,
  artifact: PiwinConfig['artifact'] | undefined,
): Promise<ResolvedArtifactCapability | undefined> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
  const scopeKey = artifactScopeKeyForIndexRecord(record ?? undefined);
  return scopeKey === undefined
    ? undefined
    : resolveGenerationArtifactCapability(artifact, scopeKey, record?.kind === 'subagent');
}
