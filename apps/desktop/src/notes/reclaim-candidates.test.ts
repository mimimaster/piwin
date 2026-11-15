import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionRenderResources } from '../session/session-render-resources.js';
import { collectReclaimCandidates } from './reclaim-candidates.js';
import { countCandidates } from './reclaim-policy.js';
import { requestManualReclaim } from './reclaim-wiring.js';

const MIB = 1024 * 1024;

afterEach(() => sessionRenderResources.reset());

describe('presentation reclaim candidates', () => {
  it('protects the sole visible presentation and offers no manual release', async () => {
    const release = vi.fn();
    sessionRenderResources.register('current', release);
    sessionRenderResources.setVisible(['current']);
    const candidates = collectReclaimCandidates();
    expect(countCandidates(candidates, new Set())).toEqual({ eligible: 0, protected: 1, blocked: 0 });
    expect(candidates).toEqual([expect.objectContaining({
      kind: 'presentation', estimatedBytes: 8 * MIB, protectionScore: Number.POSITIVE_INFINITY,
    })]);
    expect(await requestManualReclaim()).toEqual({
      releasedBytes: 0, releasedKeys: [], reason: 'no-candidates',
    });
    expect(release).not.toHaveBeenCalled();
  });

  it('counts each registered resource with overlapping visibility and restore guards once', () => {
    sessionRenderResources.register('visible', vi.fn());
    sessionRenderResources.register('visible', vi.fn());
    sessionRenderResources.register('restoring', vi.fn());
    sessionRenderResources.register('idle', vi.fn());
    sessionRenderResources.setVisible(['visible']);
    sessionRenderResources.setRestoring('visible', true);
    sessionRenderResources.setRestoring('restoring', true);
    sessionRenderResources.setRestoring('unregistered', true);
    const candidates = collectReclaimCandidates();
    expect(candidates.find((candidate) => Number.isFinite(candidate.protectionScore)))
      .toMatchObject({ key: 'presentation:non-visible', estimatedBytes: 8 * MIB });
    expect(candidates.find((candidate) => !Number.isFinite(candidate.protectionScore)))
      .toMatchObject({ estimatedBytes: 24 * MIB });
  });

  it('protects presentations before the visible-session inventory is available', () => {
    sessionRenderResources.register('unknown', vi.fn());
    expect(countCandidates(collectReclaimCandidates(), new Set()))
      .toEqual({ eligible: 0, protected: 1, blocked: 0 });
  });
});
