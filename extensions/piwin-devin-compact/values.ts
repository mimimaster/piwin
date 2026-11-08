type Loose = Record<string, unknown>;

export function asLoose(value: unknown): Loose | undefined {
  return typeof value === 'object' && value !== null ? (value as Loose) : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars / 2);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n…[truncated ${text.length - maxChars} chars]…\n${text.slice(-tail)}`;
}

export function oneLine(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars)}…`;
}
