import { describe, expect, it } from 'vitest';
import { applyAgentModeToPrompt, getAgentMode } from './agent-mode';

describe('agent-mode', () => {
  it('prefixes agent mode with the operating contract', () => {
    const out = applyAgentModeToPrompt('agent', 'hello');
    expect(out).toContain('[piwin-mode:agent]');
    expect(out).toContain('piwin-prompt-meta');
    expect(out).toContain('Operating contract');
    expect(out).toContain('Success:');
    expect(out).toContain('Stop:');
    expect(out).toContain('Verify:');
    // Structured lines (not flattened into one prose blob).
    expect(out).toMatch(/^Success:/m);
    expect(out).toMatch(/^Stop:/m);
    expect(out).toMatch(/^Verify:/m);
    expect(out).not.toMatch(/Success:.*Stop:.*Verify:/); // not a single-line mash
    expect(out).toContain('hello');
  });

  it('prefixes plan mode with non-mutating constraints', () => {
    const out = applyAgentModeToPrompt('plan', 'build auth');
    expect(out).toContain('[piwin-mode:plan]');
    expect(out).toContain('Plan Mode');
    expect(out).toContain('build auth');
    expect(getAgentMode('plan').description).toMatch(/implementation plan/i);
  });
});
