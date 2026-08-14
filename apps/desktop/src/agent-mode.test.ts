import { describe, expect, it } from 'vitest';
import { applyAgentModeToPrompt, getAgentMode } from './agent-mode';

describe('agent-mode', () => {
  it('prefixes agent mode with a compact generation-contract marker', () => {
    const out = applyAgentModeToPrompt('agent', 'hello');
    expect(out).toBe('[piwin-mode:agent]\nUser:\nhello');
    expect(out).not.toContain('Operating contract');
  });

  it('prefixes plan mode with non-mutating constraints', () => {
    const out = applyAgentModeToPrompt('plan', 'build auth');
    expect(out).toContain('[piwin-mode:plan]');
    expect(out).toContain('Plan Mode');
    expect(out).toContain('build auth');
    expect(getAgentMode('plan').description).toMatch(/implementation plan/i);
  });

  it('prefixes goal mode with autonomous iteration constraints', () => {
    const out = applyAgentModeToPrompt('goal', 'build feature');
    expect(out).toContain('[piwin-mode:goal]');
    expect(out).toContain('Goal Mode');
    expect(out).toContain('build feature');
    expect(getAgentMode('goal').description).toMatch(/goal/i);
  });
});

