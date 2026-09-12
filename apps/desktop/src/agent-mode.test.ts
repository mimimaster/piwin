import { describe, expect, it } from 'vitest';
import { AGENT_MODES, applyAgentModeToPrompt, getAgentMode } from './agent-mode';

describe('agent-mode', () => {
  it('exposes only Agent and Goal as composer modes', () => {
    expect(AGENT_MODES.map((mode) => mode.id)).toEqual(['agent', 'goal']);
  });

  it('prefixes agent mode with the every-turn operating contract', () => {
    const out = applyAgentModeToPrompt('agent', 'hello');
    expect(out).toContain('[piwin-mode:agent]');
    expect(out).toContain('Operating contract for this turn:');
    expect(out).toContain('Tool-loop silence');
    expect(out).toContain('User:\nhello');
  });

  it('prefixes goal mode with autonomous iteration constraints', () => {
    const out = applyAgentModeToPrompt('goal', 'build feature');
    expect(out).toContain('[piwin-mode:goal]');
    expect(out).toContain('Goal Mode');
    expect(out).toContain('build feature');
    expect(getAgentMode('goal').description).toMatch(/goal/i);
  });
});

