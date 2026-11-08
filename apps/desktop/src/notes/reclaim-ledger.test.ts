import { afterEach, describe, expect, it } from 'vitest';
import {
  RECLAIM_LEDGER_MAX_EPISODES,
  latestReclaimOutcome,
  listReclaimEpisodes,
  recordReclaimEpisode,
  resetReclaimLedger,
} from './reclaim-ledger';
import { countCandidates } from './reclaim-policy';
import { desktopMetrics } from '../run-activity/diagnostic-metrics';
import type { ReclaimEpisode } from './reclaim-coordinator';

function episode(id: number, outcome: ReclaimEpisode['outcome'] = 'recovered'): ReclaimEpisode {
  return {
    episodeId: id,
    startedAtMs: id * 1000,
    level: 'critical',
    admitted: true,
    rounds: [{ kind: 'episode-terminal', atMs: id * 1000, detail: 'test' }],
    releasedBytesEstimate: 1024,
    ...(outcome === undefined ? {} : { outcome }),
    endedAtMs: id * 1000 + 500,
  };
}

afterEach(() => {
  resetReclaimLedger();
});

describe('reclaim-ledger', () => {
  it('records and lists episodes oldest → newest', () => {
    recordReclaimEpisode(episode(1));
    recordReclaimEpisode(episode(2, 'no-progress'));
    const list = listReclaimEpisodes();
    expect(list.map((e) => e.episodeId)).toEqual([1, 2]);
    expect(latestReclaimOutcome()).toBe('no-progress');
    // The list is a copy — mutating it cannot corrupt the ring.
    list.pop();
    expect(listReclaimEpisodes()).toHaveLength(2);
  });

  it('bounds the ring at RECLAIM_LEDGER_MAX_EPISODES', () => {
    for (let i = 0; i < RECLAIM_LEDGER_MAX_EPISODES + 10; i += 1) {
      recordReclaimEpisode(episode(i));
    }
    const list = listReclaimEpisodes();
    expect(list).toHaveLength(RECLAIM_LEDGER_MAX_EPISODES);
    // Oldest episodes fell off; the tail is the newest.
    expect(list[0]?.episodeId).toBe(10);
    expect(list[list.length - 1]?.episodeId).toBe(RECLAIM_LEDGER_MAX_EPISODES + 9);
  });

  it('exposes episode count through desktopMetrics', () => {
    recordReclaimEpisode(episode(1));
    recordReclaimEpisode(episode(2));
    const snapshot = desktopMetrics.collectObservability(null);
    expect(snapshot.resourceCounts['reclaimEpisodes']).toBe(2);
  });

  it('latestReclaimOutcome is undefined on an empty ring', () => {
    expect(latestReclaimOutcome()).toBeUndefined();
  });
});

describe('countCandidates', () => {
  it('partitions eligible / protected / blocked', () => {
    const counts = countCandidates(
      [
        {
          kind: 'cache-entries',
          key: 'done',
          estimatedBytes: 1,
          protectionScore: 0,
          lastTouchedMs: 0,
          restoreCost: 0,
        },
        {
          kind: 'cache-entries',
          key: 'free',
          estimatedBytes: 1,
          protectionScore: 0,
          lastTouchedMs: 0,
          restoreCost: 0,
        },
        {
          kind: 'presentation',
          key: 'visible',
          estimatedBytes: 1,
          protectionScore: Number.POSITIVE_INFINITY,
          lastTouchedMs: 0,
          restoreCost: 0,
        },
      ],
      new Set(['done']),
    );
    expect(counts).toEqual({ eligible: 1, protected: 1, blocked: 1 });
  });
});
