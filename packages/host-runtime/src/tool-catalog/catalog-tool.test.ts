import { describe, expect, it } from 'vitest';
import { estimateHostTokens } from '@piwin/contracts';
import { buildMcpCapabilityBrief } from '../mcp-capability-brief.js';
import { MODEL_TOOL_DESCRIPTION_MAX_CHARS } from '../model-tool-descriptor.js';
import { buildHostToolboxDescriptor } from './catalog-tool.js';

const TYPICAL_HOST_TARGETS = [
  'browser_click',
  'browser_navigate',
  'flashcard_create',
  'image_gen',
  'note_search',
  'process_start',
  'video_gen',
] as const;

describe('buildHostToolboxDescriptor token budget', () => {
  it('keeps the resident catalog shell smaller than the old toolbox-plus-gateway pair', () => {
    const brief = buildMcpCapabilityBrief({
      config: {
        mcpServers: {
          docs: { command: 'node' },
          github: { command: 'node' },
        },
      },
      cachedToolsByServer: {
        docs: [
          {
            serverId: 'docs',
            toolName: 'search',
            selector: 'docs.search',
            description: 'Search docs',
            inputSchema: { type: 'object' },
            metadataFingerprint: 'test-fingerprint',
            fetchedAt: '2026-07-24T00:00:00.000Z',
          },
        ],
      },
      directExposedNames: ['mcp__docs__search'],
    });
    const descriptor = buildHostToolboxDescriptor(TYPICAL_HOST_TARGETS, brief);
    const serialized = JSON.stringify(descriptor);
    const oldToolboxPlusGatewayChars = 2_400;

    expect(descriptor.description.length).toBeLessThanOrEqual(MODEL_TOOL_DESCRIPTION_MAX_CHARS);
    expect(serialized.length).toBeLessThanOrEqual(oldToolboxPlusGatewayChars);
    expect(estimateHostTokens(serialized)).toBeLessThanOrEqual(800);
    expect(descriptor.parameters.properties).toMatchObject({
      action: { enum: ['search', 'describe', 'call', 'status'] },
      target: { type: 'string' },
    });
    expect(
      (descriptor.parameters.properties as { target?: { enum?: string[] } }).target?.enum,
    ).toBeUndefined();
  });
});
