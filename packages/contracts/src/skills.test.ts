import { describe, expect, it } from 'vitest';
import {
  extractSkillUserRequest,
  formatSkillPrompt,
  stripSkillMarkdownFrontmatter,
  type SkillSummary,
} from './skills.js';

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

  it('injects Skill instructions when skillBody is provided', () => {
    const text = formatSkillPrompt('demo', 'demo', 'do the thing', {
      skillBody: '1. Read the repo\n2. Ship it',
    });
    expect(text).toContain('## Skill instructions');
    expect(text).toContain('1. Read the repo');
    expect(text).toContain('## User request');
    expect(text).toContain('do the thing');
    expect(extractSkillUserRequest(text)).toBe('do the thing');
  });
});

describe('extractSkillUserRequest / stripSkillMarkdownFrontmatter', () => {
  it('parses the thin wrapper separator', () => {
    expect(
      extractSkillUserRequest(
        formatSkillPrompt('demo', 'demo', 'ship auth'),
      ),
    ).toBe('ship auth');
  });

  it('strips YAML frontmatter from SKILL.md', () => {
    expect(
      stripSkillMarkdownFrontmatter('---\nname: demo\n---\n\n# Hello\n\nBody'),
    ).toBe('# Hello\n\nBody');
  });
});
