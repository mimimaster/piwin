import { describe, expect, it } from 'vitest';
import { PRESET_TEMPLATES } from './presets.js';

describe('PRESET_TEMPLATES', () => {
  it('locks generate-flashcard to one card via flashcard_create', () => {
    const preset = PRESET_TEMPLATES['generate-flashcard'];
    expect(preset).toMatch(/flashcard_create/);
    expect(preset).toMatch(/exactly one|一张|single card/i);
    expect(preset).toMatch(/atomic question/i);
    expect(preset).toMatch(/at most two sentences/i);
    expect(preset).toMatch(/already created/i);
    expect(preset).toMatch(/selection ref|attached selection/i);
  });
});
