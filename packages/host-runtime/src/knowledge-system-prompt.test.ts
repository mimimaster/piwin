import { describe, expect, it } from 'vitest';
import { formatMountedKnowledgeBasePrompt } from './knowledge-system-prompt.js';

describe('formatMountedKnowledgeBasePrompt', () => {
  it('returns empty when nothing is mounted', () => {
    expect(formatMountedKnowledgeBasePrompt([])).toBe('');
  });

  it('lists mounted names and grounding rules', () => {
    const prompt = formatMountedKnowledgeBasePrompt(['Notes', 'Docs']);
    expect(prompt).toContain('- Notes');
    expect(prompt).toContain('- Docs');
    expect(prompt).toContain('call knowledge_search first');
    expect(prompt).toContain('[n]');
    expect(prompt).toContain('not found in the knowledge base');
  });
});
