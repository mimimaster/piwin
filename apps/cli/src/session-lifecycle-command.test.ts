import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse, SessionLifecyclePlan } from '@piwin/contracts';
import {
  formatSessionLifecycleApplyResult,
  runSessionLifecycleApply,
  runSessionLifecyclePlan,
  type SessionLifecycleHostClient,
} from './session-lifecycle-command.js';

function createClient(response: HostResponse): SessionLifecycleHostClient & {
  handleCommand: ReturnType<typeof vi.fn>;
} {
  return {
    handleCommand: vi.fn(async (_command: HostCommand) => response),
  };
}

describe('session lifecycle CLI helpers', () => {
  it('prints a plan and the explicit apply command', async () => {
    const plan: SessionLifecyclePlan = {
      planId: 'plan-123',
      generatedAt: '2026-08-12T00:00:00.000Z',
      policy: { maxInactiveDays: 30 },
      candidates: [
        {
          sessionId: 'old-session',
          name: 'Old session',
          updatedAt: '2026-07-01T00:00:00.000Z',
          reason: 'inactive-age',
        },
      ],
      skippedPinned: 1,
      skippedNonMain: 2,
    };
    const client = createClient({
      type: 'response',
      command: 'session/lifecycle-plan',
      success: true,
      data: plan,
    });
    const print = vi.fn();

    await runSessionLifecyclePlan(client, print);

    expect(client.handleCommand).toHaveBeenCalledWith({ type: 'session/lifecycle-plan' });
    expect(print).toHaveBeenCalledWith(expect.stringContaining('plan plan-123'));
    expect(print).toHaveBeenCalledWith(
      expect.stringContaining('piwin session lifecycle apply --plan plan-123'),
    );
  });

  it('passes the user-confirmed plan id to apply', async () => {
    const client = createClient({
      type: 'response',
      command: 'session/lifecycle-apply',
      success: true,
      data: {
        planId: 'plan-123',
        appliedAt: '2026-08-12T00:00:00.000Z',
        archived: ['old-session'],
        skipped: [],
        failed: [],
      },
    });

    await runSessionLifecycleApply(client, 'plan-123', vi.fn());

    expect(client.handleCommand).toHaveBeenCalledWith({
      type: 'session/lifecycle-apply',
      planId: 'plan-123',
    });
  });

  it('renders skipped and failed sessions without hiding partial failures', () => {
    const output = formatSessionLifecycleApplyResult({
      planId: 'plan-123',
      appliedAt: '2026-08-12T00:00:00.000Z',
      archived: [],
      skipped: [{ sessionId: 'busy-session', reason: 'busy' }],
      failed: [{ sessionId: 'broken-session', error: 'disk full' }],
    });

    expect(output).toContain('skipped\tbusy-session\tbusy');
    expect(output).toContain('failed\tbroken-session\tdisk full');
  });
});
