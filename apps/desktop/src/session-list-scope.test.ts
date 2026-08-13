import { describe, expect, it } from 'vitest';
import {
  adjustSessionListScopeTotal,
  createSessionListScopeState,
  getSessionListScopeMeta,
  hiddenSessionCount,
  setSessionListScopeMeta,
} from './session-list-scope';

describe('session list scope metadata', () => {
  it('stores general and project metadata independently', () => {
    let state = createSessionListScopeState();
    state = setSessionListScopeMeta(state, { kind: 'general' }, { totalCount: 10, truncated: false });
    state = setSessionListScopeMeta(
      state,
      { kind: 'project', projectPath: '/a' },
      { totalCount: 2000, truncated: true },
    );

    expect(getSessionListScopeMeta(state, { kind: 'general' })).toEqual({
      totalCount: 10,
      truncated: false,
    });
    expect(getSessionListScopeMeta(state, { kind: 'project', projectPath: '/a' })).toEqual({
      totalCount: 2000,
      truncated: true,
    });
    expect(getSessionListScopeMeta(state, { kind: 'project', projectPath: '/b' })).toBeNull();
  });

  it('adjusts a hydrated total once and ignores unknown scopes', () => {
    let state = setSessionListScopeMeta(createSessionListScopeState(), { kind: 'general' }, {
      totalCount: 5,
      truncated: true,
    });
    state = adjustSessionListScopeTotal(state, { kind: 'general' }, 1);
    state = adjustSessionListScopeTotal(state, { kind: 'project', projectPath: '/missing' }, 4);
    expect(getSessionListScopeMeta(state, { kind: 'general' })?.totalCount).toBe(6);
    expect(getSessionListScopeMeta(state, { kind: 'project', projectPath: '/missing' })).toBeNull();
  });

  it('derives a truthful hidden count after an out-of-bound upsert', () => {
    expect(hiddenSessionCount(2005, 2000)).toBe(5);
    expect(hiddenSessionCount(2005, 2001)).toBe(4);
    expect(hiddenSessionCount(3, 3)).toBe(0);
    expect(hiddenSessionCount(2, 3)).toBe(0);
  });
});
