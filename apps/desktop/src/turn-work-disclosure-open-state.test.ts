import { describe, expect, it } from 'vitest';
import type { TurnWorkDisclosureProjection } from './turn-work-disclosure-model.js';
import {
  resolveWorkDisclosureOpen,
  toggleWorkDisclosureOverride,
} from './turn-work-disclosure-open-state.js';

const live: TurnWorkDisclosureProjection = { startIndex: 1, endIndex: 2, failureCount: 0, live: true };
const settled: TurnWorkDisclosureProjection = { startIndex: 1, endIndex: 2, failureCount: 0 };

describe('work disclosure open state', () => {
  it('uses the default until the user toggles', () => {
    expect(resolveWorkDisclosureOpen(undefined, settled, 'run-1', false)).toBe(false);
    expect(resolveWorkDisclosureOpen(undefined, settled, 'run-1', true)).toBe(true);
  });

  it('drops a live toggle once the run settles, folding into 已工作', () => {
    const opened = toggleWorkDisclosureOverride(undefined, live, 'run-1', false);
    expect(resolveWorkDisclosureOpen(opened, live, 'run-1', false)).toBe(true);
    expect(resolveWorkDisclosureOpen(opened, settled, 'run-1', false)).toBe(false);
  });

  it('keeps a toggle made after settle', () => {
    const opened = toggleWorkDisclosureOverride(undefined, settled, 'run-1', false);
    expect(resolveWorkDisclosureOpen(opened, settled, 'run-1', false)).toBe(true);
    const closed = toggleWorkDisclosureOverride(opened, settled, 'run-1', false);
    expect(resolveWorkDisclosureOpen(closed, settled, 'run-1', false)).toBe(false);
  });

  it('resets when a resumed run joins the turn', () => {
    const openedWhilePaused = toggleWorkDisclosureOverride(undefined, settled, 'run-1', false);
    expect(resolveWorkDisclosureOpen(openedWhilePaused, live, 'run-1|run-2', false)).toBe(false);
    expect(resolveWorkDisclosureOpen(openedWhilePaused, settled, 'run-1|run-2', false)).toBe(false);
  });

  it('toggles from what is on screen after a live choice expired', () => {
    const opened = toggleWorkDisclosureOverride(undefined, live, 'run-1', false);
    const next = toggleWorkDisclosureOverride(opened, settled, 'run-1', false);
    expect(resolveWorkDisclosureOpen(next, settled, 'run-1', false)).toBe(true);
  });
});
