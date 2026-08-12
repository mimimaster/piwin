import { describe, expect, it } from 'vitest';
import {
  compactModelToolDescriptor,
  MODEL_SCHEMA_DESCRIPTION_MAX_CHARS,
  MODEL_TOOL_DESCRIPTION_MAX_CHARS,
} from './model-tool-descriptor.js';

describe('compactModelToolDescriptor', () => {
  it('bounds prose without changing names or JSON Schema constraints', () => {
    const original = {
      name: 'mcp__fast_context__fast_context_search',
      description: `Search code proactively. ${'long prose '.repeat(100)}`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: `Semantic search query. ${'details '.repeat(100)}`,
          },
          mode: { type: 'string', enum: ['fast', 'thorough'] },
        },
        required: ['query'],
        additionalProperties: false,
      },
    };

    const compact = compactModelToolDescriptor(original);
    const properties = compact.parameters.properties as Record<
      string,
      Record<string, unknown>
    >;

    expect(compact.name).toBe(original.name);
    expect(compact.description.length).toBeLessThanOrEqual(MODEL_TOOL_DESCRIPTION_MAX_CHARS);
    expect(properties.query?.description).toHaveLength(MODEL_SCHEMA_DESCRIPTION_MAX_CHARS);
    expect(properties.mode?.enum).toEqual(['fast', 'thorough']);
    expect(compact.parameters.required).toEqual(['query']);
    expect(compact.parameters.additionalProperties).toBe(false);
    expect(original.description).toContain('long prose long prose');
  });
});
