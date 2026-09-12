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

  it('surfaces the Host-owned queue capability', () => {
    const rows = buildCapabilityMatrix({ ...baseCaps, queuedTurns: true });
    expect(rows.find((row) => row.id === 'queuedTurns')).toMatchObject({ available: true });
  });

  it('keeps delivery/review/undo unavailable when flags are omitted or false', () => {
    const omitted = buildCapabilityMatrix(baseCaps);
    expect(omitted.find((row) => row.id === 'subagentDeliveryV1')).toMatchObject({
      available: false,
    });
    expect(omitted.find((row) => row.id === 'subagentResultReviewV1')).toMatchObject({
      available: false,
    });
    expect(omitted.find((row) => row.id === 'subagentReviewLoopV1')).toMatchObject({
      available: false,
    });
    expect(omitted.find((row) => row.id === 'turnChangeUndoV1')).toMatchObject({
      available: false,
    });

    const disabled = buildCapabilityMatrix({
      ...baseCaps,
      subagentDeliveryV1: false,
      subagentResultReviewV1: false,
      subagentReviewLoopV1: false,
      turnChangeUndoV1: false,
    });
    expect(disabled.find((row) => row.id === 'subagentDeliveryV1')?.available).toBe(false);
    expect(disabled.find((row) => row.id === 'subagentResultReviewV1')?.available).toBe(false);
    expect(disabled.find((row) => row.id === 'subagentReviewLoopV1')?.available).toBe(false);
    expect(disabled.find((row) => row.id === 'turnChangeUndoV1')?.available).toBe(false);
  });

  it('marks delivery/review/undo available only when explicitly true', () => {
    const enabled = buildCapabilityMatrix({
      ...baseCaps,
      subagentDeliveryV1: true,
      subagentResultReviewV1: true,
      subagentReviewLoopV1: true,
      turnChangeUndoV1: true,
    });
    expect(enabled.find((row) => row.id === 'subagentDeliveryV1')?.available).toBe(true);
    expect(enabled.find((row) => row.id === 'subagentResultReviewV1')?.available).toBe(true);
    expect(enabled.find((row) => row.id === 'subagentReviewLoopV1')?.available).toBe(true);
    expect(enabled.find((row) => row.id === 'turnChangeUndoV1')?.available).toBe(true);
  });
});
