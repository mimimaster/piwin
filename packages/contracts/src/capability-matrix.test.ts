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
  automation: true,
  process: true,
};

describe('capability-matrix', () => {
  it('marks PTY unavailable with shell-preview note', () => {
    const rows = buildCapabilityMatrix(baseCaps, { mode: 'rpc', mock: false });
    const pty = rows.find((row) => row.id === 'pty');
    expect(pty?.available).toBe(false);
    expect(pty?.note).toMatch(/Shell preview|ADR 0013/i);
    const isolation = rows.find((row) => row.id === 'rpcIsolation');
    expect(isolation?.available).toBe(true);
  });

  it('formats doctor lines', () => {
    const lines = formatCapabilityMatrixLines(baseCaps, { mode: 'sdk', mock: true });
    expect(lines.some((line) => line.includes('Interactive terminal'))).toBe(true);
    expect(lines.some((line) => /no —/.test(line) || line.includes(': no'))).toBe(true);
  });

  it('surfaces ADR 0040 residency capability markers', () => {
    const rows = buildCapabilityMatrix(baseCaps, { mode: 'sdk', mock: true });
    const residency = rows.find((row) => row.id === 'runtimeResidency');
    expect(residency?.available).toBe(false);
    const outline = rows.find((row) => row.id === 'sessionOutlinePage');
    expect(outline?.available).toBe(false);

    const enabled = buildCapabilityMatrix(
      { ...baseCaps, runtimeResidency: true, sessionOutlinePage: true },
      { mode: 'sdk', mock: true },
    );
    expect(enabled.find((row) => row.id === 'runtimeResidency')?.available).toBe(true);
    expect(enabled.find((row) => row.id === 'sessionOutlinePage')?.available).toBe(true);
  });
});
