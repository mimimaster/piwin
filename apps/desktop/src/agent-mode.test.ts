import { describe, expect, it } from 'vitest';
import { AGENT_MODES, applyAgentModeToPrompt, getAgentMode } from './agent-mode';

describe('agent-mode', () => {
  it('exposes only Agent and Goal as composer modes', () => {
    expect(AGENT_MODES.map((mode) => mode.id)).toEqual(['agent', 'goal']);
  });

  it('prefixes agent mode with a compact generation-contract marker', () => {
    const out = applyAgentModeToPrompt('agent', 'hello');
    expect(out).toBe('[piwin-mode:agent]\nUser:\nhello');
    expect(out).not.toContain('Operating contract');
  });

  it('still resolves retired Plan/Ask ids for leftover session chips', () => {
    expect(getAgentMode('plan').id).toBe('plan');
    expect(getAgentMode('ask').id).toBe('ask');
  });

  it('prefixes goal mode with autonomous iteration constraints', () => {
    const out = applyAgentModeToPrompt('goal', 'build feature');
    expect(out).toContain('[piwin-mode:goal]');
    expect(out).toContain('Goal Mode');
    expect(out).toContain('build feature');
    expect(getAgentMode('goal').description).toMatch(/goal/i);
  });
});

