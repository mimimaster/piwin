import { describe, expect, it } from 'vitest';
import {
  bindDraftRunMode,
  DRAFT_RUN_MODE_KEY,
  setRunModeOverride,
} from './use-workbench-desktop-config.js';

describe('per-session run mode overrides', () => {
  it('keeps picks per session and clears to follow Host', () => {
    let map = setRunModeOverride(new Map(), 's1', 'yolo');
    map = setRunModeOverride(map, 's2', 'ask');
    expect(map.get('s1')).toBe('yolo');
    expect(map.get('s2')).toBe('ask');
    map = setRunModeOverride(map, 's1', null);
    expect(map.has('s1')).toBe(false);
    expect(map.get('s2')).toBe('ask');
  });

  it('binds the blank-composer pick to the created session on first send', () => {
    const draft = setRunModeOverride(new Map(), DRAFT_RUN_MODE_KEY, 'auto');
    const bound = bindDraftRunMode(draft, 's9');
    expect(bound.get('s9')).toBe('auto');
    expect(bound.has(DRAFT_RUN_MODE_KEY)).toBe(false);
  });

  it('does not overwrite an existing session pick, and is a no-op without a draft pick', () => {
    const map = setRunModeOverride(
      setRunModeOverride(new Map(), 's1', 'ask'),
      DRAFT_RUN_MODE_KEY,
      'yolo',
    );
    expect(bindDraftRunMode(map, 's1').get('s1')).toBe('ask');
    const empty = new Map();
    expect(bindDraftRunMode(empty, 's1')).toBe(empty);
  });
});
