import type { ModelRef } from '@piwin/contracts';
import { listAllSessionRecords, upsertSessionRecord } from '@piwin/session';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';

export type RewritePersistedChannelRefsInput = {
  piwinRoot?: string;
  fromProviderId: string;
  toProviderId: string;
  sessionModels?: Map<string, ModelRef>;
};

/**
 * Relocate channel ids on live persist surfaces other than config.json.
 * Transcript history model snapshots stay as they were.
 */
export async function rewritePersistedChannelRefs(
  input: RewritePersistedChannelRefsInput,
): Promise<void> {
  const indexPath = getPiwinSessionIndexPath(getPiwinRoot(input.piwinRoot));
  const records = await listAllSessionRecords(indexPath);
  for (const record of records) {
    const nextModel = rewriteChannelRef(record.model, input.fromProviderId, input.toProviderId);
    if (!nextModel || nextModel === record.model) {
      continue;
    }
    await upsertSessionRecord(indexPath, { ...record, model: nextModel });
  }
  if (!input.sessionModels) {
    return;
  }
  for (const [sessionId, model] of input.sessionModels) {
    const next = rewriteChannelRef(model, input.fromProviderId, input.toProviderId);
    if (next && next !== model) {
      input.sessionModels.set(sessionId, next);
    }
  }
}

function rewriteChannelRef(
  model: ModelRef | undefined,
  fromProviderId: string,
  toProviderId: string,
): ModelRef | undefined {
  if (!model || model.source === 'subscription' || model.providerId !== fromProviderId) {
    return model;
  }
  return { ...model, providerId: toProviderId, source: 'channel' };
}
