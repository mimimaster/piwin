import { describe, expect, it } from 'vitest';
import { resolveStudyKeyboard } from './study-keyboard.js';

const base = {
  repeat: false,
  isComposing: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target: { tagName: 'DIV', isContentEditable: false },
};

describe('mobile study keyboard', () => {
  it('swallows study keys while a helper overlay is open', () => {
    const context = { mode: 'scheduled' as const, phase: 'answer' as const, overlayOpen: true };
    expect(resolveStudyKeyboard({ ...base, key: 'Escape' }, context)).toEqual({ type: 'close-overlay' });
    expect(resolveStudyKeyboard({ ...base, key: ' ' }, context)).toBeNull();
    expect(resolveStudyKeyboard({ ...base, key: 'Enter' }, context)).toBeNull();
    expect(resolveStudyKeyboard({ ...base, key: '3' }, context)).toBeNull();
  });

  it('maps Space to flip when no overlay is open', () => {
    expect(
      resolveStudyKeyboard({ ...base, key: ' ' }, { mode: 'sequence', phase: 'question', overlayOpen: false }),
    ).toEqual({ type: 'flip' });
  });
});
