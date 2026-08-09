import type { SessionIndexRecord, SessionTranscriptMessage } from '@piwin/contracts';
import {
  deriveDefaultNameFromMessage,
  getSessionRecord,
  isLegacyInternalSessionName,
  repairLegacyTextSessionName,
} from '@piwin/session';

export type LegacySessionNameRepairOptions = {
  indexPath: string;
  records: readonly SessionIndexRecord[];
  loadTranscriptMessages: (sessionId: string) => Promise<SessionTranscriptMessage[]>;
  onRepaired?: (record: SessionIndexRecord) => void;
  onWarning?: (message: string) => void;
};

/**
 * Repair the narrowly identifiable text titles leaked by old Desktop prompt
 * wrapping. This is safe to run during list hydration and resume: clean names
 * do no I/O, each eligible record is re-checked under the index write lock,
 * and failures never make the read command fail.
 */
export async function repairLegacySessionNames(
  options: LegacySessionNameRepairOptions,
): Promise<SessionIndexRecord[]> {
  const output: SessionIndexRecord[] = [];
  for (const record of options.records) {
    if (record.nameSource !== 'text' || !isLegacyInternalSessionName(record.name)) {
      output.push(record);
      continue;
    }

    try {
      const messages = await options.loadTranscriptMessages(record.id);
      const firstUserMessage = messages.find((message) => message.role === 'user');
      const candidate = deriveDefaultNameFromMessage(firstUserMessage?.text ?? '');
      const repaired = candidate
        ? await repairLegacyTextSessionName(options.indexPath, record.id, candidate)
        : undefined;
      if (repaired) {
        options.onRepaired?.(repaired);
        output.push(repaired);
        continue;
      }

      // A concurrent client may have repaired or manually renamed the record
      // after this list read. Return the latest authority projection if so.
      output.push((await getSessionRecord(options.indexPath, record.id)) ?? record);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      options.onWarning?.(`legacy session name repair failed for ${record.id}: ${detail}`);
      output.push(record);
    }
  }
  return output;
}
