import { describe, expect, it } from 'vitest';
import { LIVE_JOB_LOG_MAX_IDS, LIVE_SUBSCRIPTION_MAX_SESSION_IDS } from '@piwin/contracts';
import { normalizeSubscriptions } from './host-client-helpers.js';

describe('normalizeSubscriptions', () => {
  it('keeps eight unique visible Conversation sessions and drops the ninth', () => {
    const sessionIds = Array.from({ length: 9 }, (_, index) => `session-${index + 1}`);
    expect(normalizeSubscriptions({ sessionIds })?.sessionIds).toEqual(
      sessionIds.slice(0, LIVE_SUBSCRIPTION_MAX_SESSION_IDS),
    );
  });

  it('drops duplicates and invalid ids before applying the ceiling', () => {
    expect(
      normalizeSubscriptions({ sessionIds: ['', 'session-a', 'session-a', 'session-b'] }),
    ).toEqual({ sessionIds: ['session-a', 'session-b'] });
  });

  it('normalizes job monitor ids independently at LIVE_JOB_LOG_MAX_IDS', () => {
    const jobIds = Array.from({ length: 20 }, (_, index) => `job-${index}`);
    jobIds.push('job-0');
    const normalized = normalizeSubscriptions({ sessionIds: ['s-a'], jobIds });
    expect(normalized?.sessionIds).toEqual(['s-a']);
    expect(normalized?.jobIds).toEqual(jobIds.slice(0, LIVE_JOB_LOG_MAX_IDS));
  });

  it('keeps a jobIds-only interest set and drops all-empty inputs', () => {
    expect(normalizeSubscriptions({ jobIds: ['job-1'] })).toEqual({ jobIds: ['job-1'] });
    expect(normalizeSubscriptions({ sessionIds: [], jobIds: [] })).toBeUndefined();
    expect(normalizeSubscriptions({})).toBeUndefined();
  });
});
