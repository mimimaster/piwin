import { describe, expect, it } from 'vitest';
import {
  compactModelToolDescriptor,
  listModelToolSchemaDefects,
} from './model-tool-descriptor.js';
import { subagentReviewSubmitInputParameters } from './subagent-review-submit-tool.js';
import { subagentVerificationSubmitInputParameters } from './subagent-tool-input.js';

describe('listModelToolSchemaDefects', () => {
  it('flags Gemini-rejected arrays that omit items', () => {
    expect(
      listModelToolSchemaDefects({
        type: 'object',
        properties: {
          checks: { type: 'array', description: 'Bounded parent-workspace checks.' },
        },
      }),
    ).toEqual(['parameters.properties.checks.items']);
  });

  it('accepts arrays that declare items', () => {
    expect(
      listModelToolSchemaDefects({
        type: 'object',
        properties: {
          checks: { type: 'array', items: { type: 'string' } },
        },
      }),
    ).toEqual([]);
  });
});

describe('model-facing subagent schemas', () => {
  it('declares checks.items for verification submit', () => {
    expect(listModelToolSchemaDefects(subagentVerificationSubmitInputParameters)).toEqual([]);
    expect(subagentVerificationSubmitInputParameters.properties.checks).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          status: { type: 'string', enum: ['passed', 'failed'] },
          evidence: { type: 'string' },
        },
        required: ['label', 'status', 'evidence'],
      },
    });
  });

  it('declares findings.items and verification.items for review submit', () => {
    expect(listModelToolSchemaDefects(subagentReviewSubmitInputParameters)).toEqual([]);
    expect(subagentReviewSubmitInputParameters.properties.findings).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'severity', 'title', 'detail'],
      },
    });
    expect(subagentReviewSubmitInputParameters.properties.verification).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'status'],
      },
    });
  });
});

describe('compactModelToolDescriptor', () => {
  it('fills missing array items so Gemini does not 400 the whole turn', () => {
    const compact = compactModelToolDescriptor({
      name: 'mcp__unknown__batch',
      description: 'Batch',
      parameters: {
        type: 'object',
        properties: {
          rows: { type: 'array', description: 'Rows' },
        },
      },
    });
    expect(listModelToolSchemaDefects(compact.parameters)).toEqual([]);
    expect(compact.parameters).toMatchObject({
      properties: {
        rows: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
      },
    });
  });
});
