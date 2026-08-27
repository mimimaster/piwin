import type { AgentEvent } from '@piwin/contracts';
import { asRecord } from './pi-event-read.js';

/**
 * Per-entry cap for serialized native context copies. Oversized messages keep
 * only a truncated marker so huge tool outputs never bloat the RPC pipe or the
 * transcript store; replay falls back to text for those rows.
 */
const MAX_NATIVE_ENTRY_BYTES = 262_144;

/**
 * Serialize the native Pi message carried by a `message_end` event into an
 * opaque context copy (spec: session-conversation-tree §4). Only assistant and
 * toolResult messages are captured; user rows are re-synthesized at replay.
 */
export function buildNativeContextEvent(
  record: Record<string, unknown>,
  endedMessageId: string,
  lastAssistantMessageId: string | null,
): AgentEvent | undefined {
  const message = asRecord(record.message);
  if (!message) {
    return undefined;
  }
  const role = message.role;
  if (role !== 'assistant' && role !== 'toolResult') {
    return undefined;
  }
  let payload = '';
  try {
    payload = JSON.stringify(message);
  } catch {
    return undefined;
  }
  const byteLength = Buffer.byteLength(payload, 'utf8');
  const entry =
    byteLength > MAX_NATIVE_ENTRY_BYTES
      ? { format: 'pi-message-v1' as const, payload: '', byteLength, truncated: true as const }
      : { format: 'pi-message-v1' as const, payload, byteLength };
  if (role === 'toolResult') {
    return {
      type: 'message/native_context',
      messageId: endedMessageId,
      role: 'toolResult',
      entry,
      ...(lastAssistantMessageId !== null
        ? { responseMessageId: lastAssistantMessageId }
        : {}),
    };
  }
  return {
    type: 'message/native_context',
    messageId: endedMessageId,
    role: 'assistant',
    entry,
  };
}
