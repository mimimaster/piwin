import { describe, expect, it } from 'vitest';
import { decideDraftTransition } from './draft-transition';

const base = {
  leavingDraft: false,
  enteringDraft: false,
  skipDraftSave: false,
  preserveComposerOnSessionActivation: false,
};

describe('decideDraftTransition', () => {
  it('does nothing when switching between two live sessions', () => {
    expect(
      decideDraftTransition({
        ...base,
        leavingDraft: false,
        enteringDraft: false,
      }),
    ).toEqual({ kind: 'noop' });
  });

  it('clears the composer when the user switches to an existing session', () => {
    expect(
      decideDraftTransition({
        ...base,
        leavingDraft: true,
      }),
    ).toEqual({ kind: 'save-and-clear-composer' });
  });

  it('keeps typed text when sending from draft mode (send already cleared it)', () => {
    expect(
      decideDraftTransition({
        ...base,
        leavingDraft: true,
        skipDraftSave: true,
      }),
    ).toEqual({ kind: 'skip-draft-save' });
  });

  it('keeps typed text when pasting an image in draft mode creates a session', () => {
    // Regression: "type then paste image" used to wipe the composer because
    // the media/save session creation hit the switch-session clear path.
    expect(
      decideDraftTransition({
        ...base,
        leavingDraft: true,
        preserveComposerOnSessionActivation: true,
      }),
    ).toEqual({ kind: 'preserve-composer' });
  });

  it('prefers the send path when both flags are set', () => {
    expect(
      decideDraftTransition({
        ...base,
        leavingDraft: true,
        skipDraftSave: true,
        preserveComposerOnSessionActivation: true,
      }),
    ).toEqual({ kind: 'skip-draft-save' });
  });

  it('restores the draft when entering draft mode', () => {
    expect(
      decideDraftTransition({
        ...base,
        enteringDraft: true,
      }),
    ).toEqual({ kind: 'restore-draft' });
  });
});
