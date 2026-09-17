import { describe, expect, it } from 'vitest';
import type { AttentionRaise } from './attention-signal.js';
import {
  ATTENTION_STALE_TERMINAL_MS,
  DEFAULT_ATTENTION_PREFERENCES,
  decideAttention,
  isAttentionSessionSeen,
  type AttentionContext,
  type AttentionPreferences,
} from './attention-policy.js';

const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const SESSION_ID = 'session-1';

function raise(overrides: Partial<AttentionRaise> = {}): AttentionRaise {
  return {
    type: 'raise',
    kind: 'turn-complete',
    key: 'run:1',
    sessionId: SESSION_ID,
    source: 'run',
    ...overrides,
  };
}

function prefs(overrides: Partial<AttentionPreferences> = {}): AttentionPreferences {
  return { ...DEFAULT_ATTENTION_PREFERENCES, ...overrides };
}

function context(overrides: Partial<AttentionContext> = {}): AttentionContext {
  return {
    presence: 'inactive',
    visibleSessionIds: new Set(),
    activeSessionId: null,
    catchingUp: false,
    preferences: DEFAULT_ATTENTION_PREFERENCES,
    alreadyNotified: false,
    now: NOW,
    ...overrides,
  };
}

describe('T12 在场 + 可见 + complete → seen, none', () => {
  it('marks the visible session as seen and suppresses delivery', () => {
    const ctx = context({
      presence: 'active',
      visibleSessionIds: new Set([SESSION_ID]),
      activeSessionId: 'other',
    });
    expect(isAttentionSessionSeen(SESSION_ID, ctx)).toBe(true);
    expect(decideAttention(raise({ kind: 'turn-complete' }), ctx)).toEqual({
      seen: true,
      delivery: 'none',
      bounce: false,
    });
  });
});

describe('T13 在场 + visible 为空 + activeSessionId 匹配 → seen', () => {
  it('treats the active session as seen when nothing is listed as visible', () => {
    const ctx = context({
      presence: 'active',
      visibleSessionIds: new Set(),
      activeSessionId: SESSION_ID,
    });
    expect(isAttentionSessionSeen(SESSION_ID, ctx)).toBe(true);
    expect(decideAttention(raise(), ctx)).toEqual({
      seen: true,
      delivery: 'none',
      bounce: false,
    });
  });

  it('does not treat a different session as seen when visible is empty', () => {
    const ctx = context({
      presence: 'active',
      visibleSessionIds: new Set(),
      activeSessionId: SESSION_ID,
    });
    expect(isAttentionSessionSeen('other', ctx)).toBe(false);
  });
});

describe('T14 在场 + 不可见 + foregroundToast', () => {
  const unseenActive = context({
    presence: 'active',
    visibleSessionIds: new Set(['other']),
    activeSessionId: 'other',
  });

  it('delivers in-app when foregroundToast is on', () => {
    expect(decideAttention(raise(), unseenActive)).toEqual({
      seen: false,
      delivery: 'in-app',
      bounce: false,
    });
  });

  it('delivers none when foregroundToast is off', () => {
    expect(
      decideAttention(raise(), context({ ...unseenActive, preferences: prefs({ foregroundToast: false }) })),
    ).toEqual({
      seen: false,
      delivery: 'none',
      bounce: false,
    });
  });
});

describe('T15 不在场 + complete + onComplete=false → none, seen=false', () => {
  it('suppresses an unseen complete when onComplete is off', () => {
    const ctx = context({
      presence: 'inactive',
      visibleSessionIds: new Set([SESSION_ID]),
      activeSessionId: SESSION_ID,
      preferences: prefs({ onComplete: false }),
    });
    expect(isAttentionSessionSeen(SESSION_ID, ctx)).toBe(false);
    expect(decideAttention(raise({ kind: 'turn-complete' }), ctx)).toEqual({
      seen: false,
      delivery: 'none',
      bounce: false,
    });
  });
});

describe('T16 不在场 + needs-input → system + bounce', () => {
  const away = context({
    presence: 'inactive',
    visibleSessionIds: new Set(),
    activeSessionId: SESSION_ID,
  });
  const needsInput = raise({ kind: 'needs-input', source: 'permission', key: 'perm:1' });

  it('bounces when bounceOnNeedsInput is on', () => {
    expect(decideAttention(needsInput, away)).toEqual({
      seen: false,
      delivery: 'system',
      bounce: true,
    });
  });

  it('does not bounce when bounceOnNeedsInput is off', () => {
    expect(
      decideAttention(needsInput, context({ ...away, preferences: prefs({ bounceOnNeedsInput: false }) })),
    ).toEqual({
      seen: false,
      delivery: 'system',
      bounce: false,
    });
  });
});

describe('T17 enabled=false → none；alreadyNotified → none', () => {
  it('returns none with AN-R05 seen when notifications are disabled', () => {
    const seenCtx = context({
      presence: 'active',
      visibleSessionIds: new Set([SESSION_ID]),
      preferences: prefs({ enabled: false }),
    });
    expect(decideAttention(raise(), seenCtx)).toEqual({
      seen: true,
      delivery: 'none',
      bounce: false,
    });

    const unseenCtx = context({
      presence: 'inactive',
      preferences: prefs({ enabled: false }),
    });
    expect(decideAttention(raise(), unseenCtx)).toEqual({
      seen: false,
      delivery: 'none',
      bounce: false,
    });
  });

  it('returns none with AN-R05 seen when alreadyNotified', () => {
    const seenCtx = context({
      presence: 'active',
      visibleSessionIds: new Set([SESSION_ID]),
      alreadyNotified: true,
    });
    expect(decideAttention(raise(), seenCtx)).toEqual({
      seen: true,
      delivery: 'none',
      bounce: false,
    });

    const unseenCtx = context({
      presence: 'inactive',
      alreadyNotified: true,
    });
    expect(decideAttention(raise(), unseenCtx)).toEqual({
      seen: false,
      delivery: 'none',
      bounce: false,
    });
  });
});

describe('T18 catchingUp / stale endedAt → catch-up-summary', () => {
  it('returns catch-up-summary while catchingUp', () => {
    const ctx = context({
      presence: 'inactive',
      catchingUp: true,
    });
    expect(decideAttention(raise(), ctx)).toEqual({
      seen: false,
      delivery: 'catch-up-summary',
      bounce: false,
    });
  });

  it('returns catch-up-summary when endedAt is older than 15 minutes', () => {
    const endedAt = new Date(NOW - ATTENTION_STALE_TERMINAL_MS - 1).toISOString();
    const ctx = context({ presence: 'inactive' });
    expect(decideAttention(raise({ endedAt }), ctx)).toEqual({
      seen: false,
      delivery: 'catch-up-summary',
      bounce: false,
    });
  });
});

describe('T19 DEFAULT_ATTENTION_PREFERENCES 等于 AN-R18', () => {
  it('matches the frozen AN-R18 defaults', () => {
    expect(DEFAULT_ATTENTION_PREFERENCES).toEqual({
      enabled: true,
      onNeedsInput: true,
      onComplete: true,
      onFailure: true,
      foregroundToast: true,
      badge: true,
      sound: true,
      bounceOnNeedsInput: true,
    });
  });
});
