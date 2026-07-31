import { describe, expect, it } from 'vitest';
import type { SkillSummary } from './skills.js';

describe('SkillSummary', () => {
  it('exposes an optional hidden flag', () => {
    const visible: SkillSummary = {
      id: 'hatch-theme',
      name: 'hatch-theme',
      description: 'x',
      source: 'bundled',
      path: '/x/SKILL.md',
      enabled: true,
    };
    const hidden: SkillSummary = {
      ...visible,
      hidden: true,
    };
    // Runtime is trivial; the real signal is that `.hidden` typechecks on the
    // public type. The scanner test (Step 4) covers actual parse behavior.
    expect(visible.hidden).toBeUndefined();
    expect(hidden.hidden).toBe(true);
  });
});
