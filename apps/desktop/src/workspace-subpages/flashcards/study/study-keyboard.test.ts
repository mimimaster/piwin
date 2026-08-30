import { describe, expect, it } from 'vitest';
import { resolveStudyKeyboard } from './study-keyboard';

const baseEvent = {
  repeat: false,
  isComposing: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target: { tagName: 'DIV', isContentEditable: false },
};

describe('resolveStudyKeyboard', () => {
  it('flips on Space in sequence and scheduled, ignores native button Space', () => {
    expect(
      resolveStudyKeyboard(
        { ...baseEvent, key: ' ' },
        { mode: 'sequence', phase: 'question', overlayOpen: false },
      ),
    ).toEqual({ type: 'flip' });
    expect(
      resolveStudyKeyboard(
        { ...baseEvent, key: ' ', target: { tagName: 'BUTTON', isContentEditable: false } },
        { mode: 'sequence', phase: 'question', overlayOpen: false },
      ),
    ).toBeNull();
  });

  it('uses Enter/Right as reveal then next only in sequence', () => {
    expect(
      resolveStudyKeyboard(
        { ...baseEvent, key: 'Enter' },
        { mode: 'sequence', phase: 'question', overlayOpen: false },
      ),
    ).toEqual({ type: 'flip' });
    expect(
      resolveStudyKeyboard(
        { ...baseEvent, key: 'ArrowRight' },
        { mode: 'sequence', phase: 'answer', overlayOpen: false },
      ),
    ).toEqual({ type: 'next' });
    expect(
      resolveStudyKeyboard(
        { ...baseEvent, key: 'Enter' },
        { mode: 'scheduled', phase: 'answer', overlayOpen: false },
      ),
    ).toBeNull();
  });

  it('rates 1-4 only on the scheduled answer face', () => {
    expect(
      resolveStudyKeyboard(
        { ...baseEvent, key: '3' },
        { mode: 'scheduled', phase: 'answer', overlayOpen: false },
      ),
    ).toEqual({ type: 'rate', rating: 'good' });
    expect(
      resolveStudyKeyboard(
        { ...baseEvent, key: '3' },
        { mode: 'scheduled', phase: 'question', overlayOpen: false },
      ),
    ).toBeNull();
    expect(
      resolveStudyKeyboard(
        { ...baseEvent, key: '1' },
        { mode: 'sequence', phase: 'answer', overlayOpen: false },
      ),
    ).toBeNull();
  });

  it('layers Escape: overlay first, then leave', () => {
    expect(
      resolveStudyKeyboard(
        { ...baseEvent, key: 'Escape' },
        { mode: 'sequence', phase: 'question', overlayOpen: true },
      ),
    ).toEqual({ type: 'close-overlay' });
    expect(
      resolveStudyKeyboard(
        { ...baseEvent, key: 'Escape' },
        { mode: 'sequence', phase: 'question', overlayOpen: false },
      ),
    ).toEqual({ type: 'leave' });
  });

  it('swallows Space, Enter, and 1-4 while an overlay is open', () => {
    const sequenceOpen = { mode: 'sequence' as const, phase: 'answer' as const, overlayOpen: true };
    const scheduledOpen = { mode: 'scheduled' as const, phase: 'answer' as const, overlayOpen: true };
    expect(resolveStudyKeyboard({ ...baseEvent, key: ' ' }, sequenceOpen)).toBeNull();
    expect(resolveStudyKeyboard({ ...baseEvent, key: 'Enter' }, sequenceOpen)).toBeNull();
    expect(resolveStudyKeyboard({ ...baseEvent, key: 'ArrowRight' }, sequenceOpen)).toBeNull();
    expect(resolveStudyKeyboard({ ...baseEvent, key: '3' }, scheduledOpen)).toBeNull();
    expect(resolveStudyKeyboard({ ...baseEvent, key: '1' }, scheduledOpen)).toBeNull();
    expect(
      resolveStudyKeyboard(
        { ...baseEvent, key: ' ', target: { tagName: 'BUTTON', isContentEditable: false } },
        sequenceOpen,
      ),
    ).toBeNull();
  });

  it('ignores repeat, IME, typing, and OS shortcuts', () => {
    const context = { mode: 'sequence' as const, phase: 'question' as const, overlayOpen: false };
    expect(resolveStudyKeyboard({ ...baseEvent, key: ' ', repeat: true }, context)).toBeNull();
    expect(resolveStudyKeyboard({ ...baseEvent, key: ' ', isComposing: true }, context)).toBeNull();
    expect(resolveStudyKeyboard({ ...baseEvent, key: ' ', metaKey: true }, context)).toBeNull();
    expect(
      resolveStudyKeyboard(
        { ...baseEvent, key: ' ', target: { tagName: 'INPUT', isContentEditable: false } },
        context,
      ),
    ).toBeNull();
  });
});
