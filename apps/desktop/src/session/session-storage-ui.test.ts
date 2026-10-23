import { describe, expect, it } from 'vitest';
import type { SessionColdStoragePlan } from '@piwin/contracts';
import {
  canExecuteColdStoragePlan,
  isSessionBodyOffloaded,
  sessionStorageBadgeKind,
} from './session-storage-ui';

const plan: SessionColdStoragePlan = {
  planId: 'cold-1',
  confirmationDigest: 'abc',
  generatedAt: '2026-08-13T00:00:00.000Z',
  expiresAt: '2026-08-13T00:10:00.000Z',
  action: 'offload',
  packOutputDir: '/tmp/packs',
  estimatedPeakBytes: 10,
  targets: [
    {
      sessionId: 'ses_1',
      estimatedPayloadBytes: 10,
      transcriptSha256: 'aaa',
    },
  ],
  skipped: [],
};

describe('session storage UI helpers', () => {
  it('detects offloaded and missing-pack bodies', () => {
    expect(isSessionBodyOffloaded(undefined)).toBe(false);
    expect(isSessionBodyOffloaded({ state: 'local' })).toBe(false);
    expect(isSessionBodyOffloaded({ state: 'offloaded' })).toBe(true);
    expect(isSessionBodyOffloaded({ state: 'missing-pack' })).toBe(true);
    expect(sessionStorageBadgeKind({ state: 'offloaded' })).toBe('offloaded');
    expect(sessionStorageBadgeKind({ state: 'missing-pack' })).toBe('missing-pack');
    expect(sessionStorageBadgeKind(undefined)).toBeUndefined();
  });

  it('requires saved enabled config and a confirmation digest before execute', () => {
    expect(
      canExecuteColdStoragePlan({
        enabled: true,
        packOutputDir: '/tmp/packs',
        draftDirty: false,
        plan,
      }),
    ).toBe(true);
    expect(
      canExecuteColdStoragePlan({
        enabled: false,
        packOutputDir: '/tmp/packs',
        draftDirty: false,
        plan,
      }),
    ).toBe(false);
    expect(
      canExecuteColdStoragePlan({
        enabled: true,
        packOutputDir: '/tmp/packs',
        draftDirty: true,
        plan,
      }),
    ).toBe(false);
    expect(
      canExecuteColdStoragePlan({
        enabled: true,
        packOutputDir: '',
        draftDirty: false,
        plan,
      }),
    ).toBe(false);
    expect(
      canExecuteColdStoragePlan({
        enabled: true,
        packOutputDir: '/tmp/packs',
        draftDirty: false,
        plan: { ...plan, targets: [] },
      }),
    ).toBe(false);
  });
});
