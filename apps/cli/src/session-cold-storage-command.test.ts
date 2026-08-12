import { describe, expect, it, vi } from 'vitest';
import type { HostResponse, SessionColdStoragePlan } from '@piwin/contracts';
import {
  formatPlan,
  runSessionColdStorageExecute,
  runSessionColdStoragePlan,
  type SessionColdStorageHostClient,
} from './session-cold-storage-command.js';

function createClient(response: HostResponse): SessionColdStorageHostClient & {
  handleCommand: ReturnType<typeof vi.fn>;
} {
  return {
    handleCommand: vi.fn(async () => response),
  };
}

describe('session cold storage CLI', () => {
  it('sends an explicit session plan through the Host client', async () => {
    const plan: SessionColdStoragePlan = {
      planId: 'cold-1',
      confirmationDigest: 'abc',
      generatedAt: '2026-08-13T00:00:00.000Z',
      expiresAt: '2026-08-13T00:10:00.000Z',
      action: 'offload',
      packOutputDir: '/tmp/packs',
      estimatedPeakBytes: 100,
      targets: [
        {
          sessionId: 'ses_1',
          estimatedPayloadBytes: 25,
          transcriptSha256: 'aaa',
        },
      ],
      skipped: [],
    };
    const client = createClient({
      type: 'response',
      command: 'session/cold-storage-plan',
      success: true,
      data: plan,
    });
    const lines: string[] = [];
    const result = await runSessionColdStoragePlan(client, ['ses_1'], (line) => lines.push(line));
    expect(client.handleCommand).toHaveBeenCalledWith({
      type: 'session/cold-storage-plan',
      sessionIds: ['ses_1'],
    });
    expect(result.planId).toBe('cold-1');
    expect(lines.join('\n')).toContain('--confirm abc');
  });

  it('requires a matching confirmation digest on execute', async () => {
    const client = createClient({
      type: 'response',
      command: 'session/cold-storage-execute',
      success: true,
      data: {
        planId: 'cold-1',
        executedAt: '2026-08-13T00:00:00.000Z',
        offloaded: [],
        failed: [],
      },
    });
    await runSessionColdStorageExecute(
      client,
      { planId: 'cold-1', confirmationDigest: 'abc' },
      () => undefined,
    );
    expect(client.handleCommand).toHaveBeenCalledWith({
      type: 'session/cold-storage-execute',
      planId: 'cold-1',
      confirmationDigest: 'abc',
    });
  });

  it('formats an empty plan without an execute hint', () => {
    expect(
      formatPlan({
        planId: 'cold-empty',
        confirmationDigest: 'xyz',
        generatedAt: '2026-08-13T00:00:00.000Z',
        expiresAt: '2026-08-13T00:10:00.000Z',
        action: 'offload',
        packOutputDir: '/tmp/packs',
        estimatedPeakBytes: 0,
        targets: [],
        skipped: [{ sessionId: 'ses_1', reason: 'not-archived' }],
      }),
    ).toContain('skipped\tses_1\tnot-archived');
  });
});
