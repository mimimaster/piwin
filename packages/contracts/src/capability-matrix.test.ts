import { describe, expect, it } from 'vitest';
import { buildCapabilityMatrix, formatCapabilityMatrixLines } from './capability-matrix.js';
import type { HostStatusData } from './ipc.js';

const baseCaps: HostStatusData['capabilities'] = {
  customTools: true,
  mcpLifecycle: true,
  productTranscript: true,
  compaction: true,
  extensions: true,
  prompts: true,
  sessionLifecycle: true,
  sessionPin: true,
  sessionSearch: true,
  pty: false,
  shellPreview: true,
  automation: true,
  process: true,
  rpcSdkFallback: true,
};

describe('capability-matrix', () => {
  it('marks PTY unavailable with shell-preview note', () => {
    const rows = buildCapabilityMatrix(baseCaps, { mode: 'rpc', mock: false });
    const pty = rows.find((row) => row.id === 'pty');
    expect(pty?.available).toBe(false);
    expect(pty?.note).toMatch(/Shell preview|ADR 0013/i);
    const isolation = rows.find((row) => row.id === 'rpcIsolation');
    expect(isolation?.available).toBe(false);
    expect(isolation?.note).toMatch(/SDK backend/i);
  });

  it('formats doctor lines', () => {
    const lines = formatCapabilityMatrixLines(baseCaps, { mode: 'sdk', mock: true });
    expect(lines.some((line) => line.includes('Interactive terminal'))).toBe(true);
    expect(lines.some((line) => /no —/.test(line) || line.includes(': no'))).toBe(true);
  });
});
