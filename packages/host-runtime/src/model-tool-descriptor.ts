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

/**
 * Paths Gemini rejects: `type: array` without `items`.
 * Used to keep Host/MCP tool parameters from 400ing a whole turn.
 */
export function listModelToolSchemaDefects(
  schema: unknown,
  path = 'parameters',
): string[] {
  const defects: string[] = [];
  collectSchemaDefects(schema, path, defects);
  return defects;
}

function compactSchemaObject(value: Record<string, unknown>): Record<string, unknown> {
  const compacted = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, compactSchemaValue(key, child)]),
  );
  if (schemaIsArray(compacted) && compacted.items === undefined) {
    return {
      ...compacted,
      items: { type: 'object', additionalProperties: true },
    };
  }
  return compacted;
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

function collectSchemaDefects(node: unknown, path: string, defects: string[]): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return;
  }
  const schema = node as Record<string, unknown>;
  if (schemaIsArray(schema) && schema.items === undefined) {
    defects.push(`${path}.items`);
  }
  if (schema.items !== undefined) {
    collectSchemaDefects(schema.items, `${path}.items`, defects);
  }
  const properties = schema.properties;
  if (properties !== null && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [key, child] of Object.entries(properties as Record<string, unknown>)) {
      collectSchemaDefects(child, `${path}.properties.${key}`, defects);
    }
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const combo = schema[key];
    if (!Array.isArray(combo)) {
      continue;
    }
    combo.forEach((child, index) => {
      collectSchemaDefects(child, `${path}.${key}[${String(index)}]`, defects);
    });
  }
}

function schemaIsArray(schema: Record<string, unknown>): boolean {
  const type = schema.type;
  return type === 'array' || (Array.isArray(type) && type.includes('array'));
}
