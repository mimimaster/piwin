import { describe, expect, it } from 'vitest';
import { formatSkillDiscoveryPrompt } from './skills-system-prompt.js';

describe('formatSkillDiscoveryPrompt', () => {
  it('returns empty when no skills are active', () => {
    expect(formatSkillDiscoveryPrompt({ skillCount: 0, piBuiltinToolNames: ['read'] })).toBe('');
  });

  it('returns empty when Pi will not render the catalog (no read tool)', () => {
    expect(formatSkillDiscoveryPrompt({ skillCount: 3, piBuiltinToolNames: ['grep'] })).toBe('');
  });

  it('tells the model to load matching skills without being asked', () => {
    const prompt = formatSkillDiscoveryPrompt({ skillCount: 3, piBuiltinToolNames: ['read'] });
    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('read the exact `<location>` path with the read tool first');
    expect(prompt).toContain('Do not invent bundled-assets');
  });
});
