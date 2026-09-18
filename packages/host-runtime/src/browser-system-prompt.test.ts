import { describe, expect, it } from 'vitest';
import { formatBrowserSystemPrompt } from './browser-system-prompt.js';

describe('formatBrowserSystemPrompt', () => {
  it('returns undefined without status and snapshot', () => {
    expect(formatBrowserSystemPrompt([])).toBeUndefined();
  });

  it('injects workflow when both tools exist', () => {
    const prompt = formatBrowserSystemPrompt([
      { descriptor: { name: 'browser_status', description: '', parameters: {} } },
      { descriptor: { name: 'browser_snapshot', description: '', parameters: {} } },
    ]);
    expect(prompt).toContain('browser_status to inspect the current page');
    expect(prompt).not.toContain('browser_lock');
    expect(prompt).toContain('The user shares this browser');
    expect(prompt).toContain('Do not claim visual verification');
    expect(prompt).not.toContain('browser_act');
  });

  it('steers toward browser_act only when the fast decider registered it', () => {
    const prompt = formatBrowserSystemPrompt([
      { name: 'browser_status' },
      { name: 'browser_snapshot' },
      { name: 'browser_act' },
    ]);
    expect(prompt).toContain('call browser_act with that intent');
  });
});
