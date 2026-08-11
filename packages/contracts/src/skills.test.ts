import { describe, expect, it } from 'vitest';
import { formatSkillPrompt, type SkillSummary } from './skills.js';

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

describe('formatSkillPrompt', () => {
  it('keeps explicit Skill identity separate from the user request', () => {
    expect(formatSkillPrompt('writing-plans', 'writing-plans', 'add auth')).toBe(
      [
        '[piwin-skill:writing-plans]',
        'Follow the installed skill "writing-plans" (id: writing-plans). Apply its workflow to the user request below.',
        '---',
        'add auth',
      ].join('\n'),
    );
  });
});
