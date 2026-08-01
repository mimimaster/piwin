import { describe, expect, it } from 'vitest';
import { applyAgentModeToPrompt, getAgentMode } from './agent-mode';

describe('agent-mode', () => {
  it('leaves agent mode text unchanged', () => {
    expect(applyAgentModeToPrompt('agent', 'hello')).toBe('hello');
  });

  it('prefixes plan mode with non-mutating constraints', () => {
    const out = applyAgentModeToPrompt('plan', 'build auth');
    expect(out).toContain('[piwin-mode:plan]');
    expect(out).toContain('Plan Mode');
    expect(out).toContain('build auth');
    expect(getAgentMode('plan').description).toMatch(/implementation plan/i);
  });
});
