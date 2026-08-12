/** Bounded model projection for Host tool metadata. Executors keep the full registration. */

import type { HostToolDescriptor } from '@piwin/contracts';

export const MODEL_TOOL_DESCRIPTION_MAX_CHARS = 360;
export const MODEL_SCHEMA_DESCRIPTION_MAX_CHARS = 180;

/**
 * Keep tool names and JSON Schema semantics exact while bounding prose that is
 * paid on every generation. This never changes the Host-local registration,
 * executor, family, or permission declaration.
 */
export function compactModelToolDescriptor(descriptor: HostToolDescriptor): HostToolDescriptor {
  return {
    name: descriptor.name,
    description: compactText(descriptor.description, MODEL_TOOL_DESCRIPTION_MAX_CHARS),
    parameters: compactSchemaObject(descriptor.parameters),
  };
}

function compactSchemaObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, compactSchemaValue(key, child)]),
  );
}

function compactSchemaValue(key: string, value: unknown): unknown {
  if (key === 'description' && typeof value === 'string') {
    return compactText(value, MODEL_SCHEMA_DESCRIPTION_MAX_CHARS);
  }
  if (Array.isArray(value)) {
    return value.map((child) => compactSchemaValue('', child));
  }
  if (value !== null && typeof value === 'object') {
    return compactSchemaObject(value as Record<string, unknown>);
  }
  return value;
}

function compactText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}
