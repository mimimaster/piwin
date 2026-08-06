import { describe, expect, it } from 'vitest';
import { buildPiSessionToolAllowlist } from './pi-session-tool-allowlist.js';

describe('buildPiSessionToolAllowlist', () => {
  it('unions pi built-ins with host tool names so Pi does not drop customTools', () => {
    expect(
      buildPiSessionToolAllowlist({
        piBuiltinToolNames: ['read', 'grep', 'ls'],
        hostTools: [
          { name: 'bash' },
          { name: 'write_file' },
          { name: 'web_search' },
          { name: 'mcp_gateway' },
        ],
      }),
    ).toEqual([
      'read',
      'grep',
      'ls',
      'bash',
      'write_file',
      'web_search',
      'mcp_gateway',
    ]);
  });

  it('keeps an empty allowlist when both sides are empty (no default Pi tools)', () => {
    expect(
      buildPiSessionToolAllowlist({
        piBuiltinToolNames: [],
        hostTools: [],
      }),
    ).toEqual([]);
  });

  it('dedupes names that appear on both sides', () => {
    expect(
      buildPiSessionToolAllowlist({
        piBuiltinToolNames: ['read', 'bash'],
        hostTools: [{ name: 'bash' }, { name: 'read' }, { name: 'run_bash' }],
      }),
    ).toEqual(['read', 'bash', 'run_bash']);
  });

  it('still exposes host-only tools when pi built-ins are empty', () => {
    expect(
      buildPiSessionToolAllowlist({
        piBuiltinToolNames: [],
        hostTools: [{ name: 'bash' }, { name: 'process_start' }],
      }),
    ).toEqual(['bash', 'process_start']);
  });
});
