import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARTIFACT_INIT_LEASE_TIMEOUT_MS,
  createArtifactFrameLease,
} from './artifact-frame-lease.js';
import {
  getActiveArtifactInitCount,
  getQueuedArtifactInitCount,
  resetArtifactInitQueueForTests,
} from './artifact-init-queue.js';
import {
  MAX_LIVE_ARTIFACT_IFRAMES,
  getLiveArtifactHostIdsForTests,
  getWaitingArtifactHostIdsForTests,
  resetArtifactLiveHostRegistryForTests,
} from './artifact-live-host-registry.js';
import { resolveArtifactFrameLifecycleState } from './artifact-frame-lifecycle.js';

const VISIBLE = { forceKeep: false, priority: 100 };
const PINNED = { forceKeep: true, priority: 1_000 };

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createArtifactFrameLease', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetArtifactInitQueueForTests();
    resetArtifactLiveHostRegistryForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts unclaimed with an empty stage rather than a paused placeholder', () => {
    const lease = createArtifactFrameLease('a');
    expect(lease.getSnapshot()).toMatchObject({ claimed: false, hostIframe: true, initGranted: false });
    expect(resolveArtifactFrameLifecycleState(lease.getSnapshot(), false)).toBe('idle');
  });

  it('walks claim → init grant → load and frees the init slot on load', async () => {
    const lease = createArtifactFrameLease('a');
    const seen: string[] = [];
    lease.subscribe(() => seen.push(resolveArtifactFrameLifecycleState(lease.getSnapshot(), false)));
    lease.claim(VISIBLE);
    expect(resolveArtifactFrameLifecycleState(lease.getSnapshot(), false)).toBe('waiting-init-lease');
    await settle();
    expect(resolveArtifactFrameLifecycleState(lease.getSnapshot(), false)).toBe('bootstrapping');
    expect(getActiveArtifactInitCount()).toBe(1);
    lease.markIframeLoaded();
    expect(resolveArtifactFrameLifecycleState(lease.getSnapshot(), true)).toBe('streaming');
    expect(resolveArtifactFrameLifecycleState(lease.getSnapshot(), false)).toBe('ready');
    expect(getActiveArtifactInitCount()).toBe(0);
    expect(seen).toContain('bootstrapping');
  });

  it('moves the init queue on when a document never loads, keeping its grant', async () => {
    const stuck = createArtifactFrameLease('stuck');
    const next = createArtifactFrameLease('next');
    stuck.claim(VISIBLE);
    next.claim(VISIBLE);
    await settle();
    expect(stuck.getSnapshot().initGranted).toBe(true);
    expect(next.getSnapshot().initGranted).toBe(false);
    vi.advanceTimersByTime(ARTIFACT_INIT_LEASE_TIMEOUT_MS);
    await settle();
    expect(stuck.getSnapshot().initGranted).toBe(true);
    expect(next.getSnapshot().initGranted).toBe(true);
  });

  it('reports a denied frame as waiting and an evicted one as recycled', async () => {
    const pinned = Array.from({ length: MAX_LIVE_ARTIFACT_IFRAMES }, (_unused, index) =>
      createArtifactFrameLease(`pinned-${index}`),
    );
    for (const lease of pinned) lease.claim(PINNED);
    const waiting = createArtifactFrameLease('waiting');
    waiting.claim(VISIBLE);
    expect(resolveArtifactFrameLifecycleState(waiting.getSnapshot(), false)).toBe('waiting-live-host');
    expect(getWaitingArtifactHostIdsForTests()).toEqual(['waiting']);

    resetArtifactLiveHostRegistryForTests();
    resetArtifactInitQueueForTests();
    const older = createArtifactFrameLease('older');
    older.claim(VISIBLE);
    await settle();
    older.markIframeLoaded();
    const crowd = Array.from({ length: MAX_LIVE_ARTIFACT_IFRAMES }, (_unused, index) =>
      createArtifactFrameLease(`crowd-${index}`),
    );
    for (const lease of crowd) lease.claim(PINNED);
    expect(older.getSnapshot()).toMatchObject({ hostIframe: false, initGranted: false, loaded: false });
    expect(resolveArtifactFrameLifecycleState(older.getSnapshot(), false)).toBe('recycled');
  });

  it('re-initializes a waiting frame when a slot frees', async () => {
    const pinned = Array.from({ length: MAX_LIVE_ARTIFACT_IFRAMES }, (_unused, index) =>
      createArtifactFrameLease(`pinned-${index}`),
    );
    for (const lease of pinned) lease.claim(PINNED);
    await settle();
    for (const lease of pinned) {
      lease.markIframeLoaded();
      await settle();
    }
    const waiting = createArtifactFrameLease('waiting');
    waiting.claim(VISIBLE);
    expect(waiting.getSnapshot().hostIframe).toBe(false);
    pinned[0]?.release();
    await settle();
    expect(waiting.getSnapshot()).toMatchObject({ hostIframe: true, initGranted: true });
  });

  it('gives everything back through one release, in any state, more than once', async () => {
    const queuedBehind = createArtifactFrameLease('first');
    queuedBehind.claim(VISIBLE);
    await settle();
    const lease = createArtifactFrameLease('a');
    lease.claim(VISIBLE);
    expect(getQueuedArtifactInitCount()).toBe(1);
    lease.release();
    lease.release();
    expect(getQueuedArtifactInitCount()).toBe(0);
    expect(getLiveArtifactHostIdsForTests()).toEqual(['first']);
    expect(lease.getSnapshot().claimed).toBe(false);

    queuedBehind.release();
    expect(getActiveArtifactInitCount()).toBe(0);
    expect(getLiveArtifactHostIdsForTests()).toEqual([]);
    vi.advanceTimersByTime(ARTIFACT_INIT_LEASE_TIMEOUT_MS * 2);
    expect(getActiveArtifactInitCount()).toBe(0);
  });

  it('can be claimed again after a release (StrictMode remount)', async () => {
    const lease = createArtifactFrameLease('a');
    lease.claim(VISIBLE);
    lease.release();
    lease.claim(VISIBLE);
    await settle();
    expect(lease.getSnapshot()).toMatchObject({ claimed: true, hostIframe: true, initGranted: true });
    expect(getActiveArtifactInitCount()).toBe(1);
  });

  it('re-ranks a held slot without restarting the document', async () => {
    const lease = createArtifactFrameLease('a');
    lease.claim(PINNED);
    await settle();
    lease.markIframeLoaded();
    lease.claim(VISIBLE);
    expect(lease.getSnapshot()).toMatchObject({ hostIframe: true, initGranted: true, loaded: true });
  });
});
