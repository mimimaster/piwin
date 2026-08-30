/**
 * Normalize upstream Codex Live client-delegation events (spike + product fixture shape).
 * Wire field names stay out of @piwin/contracts — only this private/spike layer sees them.
 */

export type NormalizedDelegation = {
  providerDelegationId: string;
  instruction: string;
};

const MAX_INSTRUCTION_BYTES = 8_192;

export function normalizeDelegationCreatedEvent(value: unknown): NormalizedDelegation | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.type !== 'delegation.created') return null;
  const item = event.item;
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  if (record.type !== 'delegation' || record.target !== 'client') return null;
  if (typeof record.id !== 'string' || !record.id.trim()) return null;
  if (!Array.isArray(record.content)) return null;

  const instruction = record.content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return [];
      const entry = part as Record<string, unknown>;
      if (entry.type === 'input_text' && typeof entry.text === 'string') return [entry.text];
      return [];
    })
    .join('')
    .trim();

  if (!instruction) return null;
  if (new TextEncoder().encode(instruction).byteLength > MAX_INSTRUCTION_BYTES) return null;

  return { providerDelegationId: record.id.trim(), instruction };
}
