/** Compile SessionCapabilitySnapshot from all policy inputs (spec §10.1). */

import { createHash } from 'node:crypto';
import type {
  CapabilityInputRevisions,
  ContextManifest,
  ContextPolicy,
  ResourceManifest,
  ResourcePolicy,
  SessionCapabilitySnapshot,
  SessionScope,
  SessionToolPolicy,
  SubagentCapabilityCeiling,
} from '@piwin/contracts';

export type CompileSnapshotInput = {
  inputs: CapabilityInputRevisions;
  scope: SessionScope;
  workingDirectory: string;
  trust: SessionCapabilitySnapshot['trust'];
  resources: ResourcePolicy;
  resourceManifest: ResourceManifest;
  context: ContextPolicy;
  contextManifest: ContextManifest;
  tools: SessionToolPolicy;
  subagentCeiling?: SubagentCapabilityCeiling;
};

/** Stable snapshot id derived from every input so equal inputs hash equal. */
export function computeSnapshotId(input: CompileSnapshotInput): string {
  const {
    inputs,
    scope,
    workingDirectory,
    trust,
    resources,
    resourceManifest,
    context,
    contextManifest,
    tools,
  } = input;
  const payload = JSON.stringify({
    inputs,
    scope,
    workingDirectory,
    trust,
    resources,
    resourceManifest,
    context,
    contextManifest,
    tools,
    subagentCeiling: input.subagentCeiling ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

/** Compile the snapshot exactly once per session/runtime generation. */
export function compileSessionCapabilitySnapshot(
  input: CompileSnapshotInput,
): SessionCapabilitySnapshot {
  const snapshotId = computeSnapshotId(input);
  const snapshot: SessionCapabilitySnapshot = {
    version: 1,
    snapshotId,
    inputs: input.inputs,
    scope: input.scope,
    workingDirectory: input.workingDirectory,
    trust: input.trust,
    resources: input.resources,
    resourceManifest: input.resourceManifest,
    context: input.context,
    contextManifest: input.contextManifest,
    tools: input.tools,
  };
  if (input.subagentCeiling) {
    snapshot.subagentCeiling = input.subagentCeiling;
  }
  return snapshot;
}
