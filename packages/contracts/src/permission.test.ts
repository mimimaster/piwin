import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERMISSION_PRESET,
  createDefaultPermissionConfig,
  createSafeFallbackPermissionConfig,
  createEmptyRuleSet,
  mergeRuleSets,
  modeToPreset,
  resolvePreset,
  mergeAgentModeIntoPrompt,
  type AgentModeId,
  type PermissionMode,
  type PermissionPreset,
} from './permission.js';

const denyRule = {
  target: { kind: 'bash' as const, pattern: 'rm -rf /' },
  decision: 'deny' as const,
  reason: 'dangerous',
};

const askRule = {
  target: { kind: 'file-write' as const, pathGlob: '/etc/*' },
  decision: 'ask' as const,
  reason: 'system files',
};

const allowRule = {
  target: { kind: 'web-fetch' as const, hostGlob: '*.example.com' },
  decision: 'allow' as const,
  reason: 'trusted',
};

describe('createDefaultPermissionConfig', () => {
  it('returns Pi-compatible YOLO mode and preset', () => {
    expect(DEFAULT_PERMISSION_PRESET).toBe('yolo');
    expect(createDefaultPermissionConfig()).toEqual({ mode: 'bypass', preset: 'yolo' });
  });

  it('provides a conservative Auto fallback for malformed config', () => {
    expect(createSafeFallbackPermissionConfig()).toEqual({ mode: 'auto', preset: 'auto' });
  });
});

describe('resolvePreset', () => {
  it('maps ask → ask-all + workspace', () => {
    expect(resolvePreset('ask')).toEqual({ mode: 'ask-all', sandbox: 'workspace' });
  });

  it('maps auto → auto + workspace', () => {
    expect(resolvePreset('auto')).toEqual({ mode: 'auto', sandbox: 'workspace' });
  });

  it('maps yolo → bypass + none', () => {
    expect(resolvePreset('yolo')).toEqual({ mode: 'bypass', sandbox: 'none' });
  });

  it('raises read-only floor under plan agent mode', () => {
    expect(resolvePreset('auto', 'plan')).toEqual({
      mode: 'ask-all',
      sandbox: 'read-only',
    });
  });

  it('raises read-only floor under ask agent mode', () => {
    expect(resolvePreset('auto', 'ask')).toEqual({
      mode: 'ask-all',
      sandbox: 'read-only',
    });
  });

  it('allows yolo under plan with bypass + none (locked: warn not block)', () => {
    expect(resolvePreset('yolo', 'plan')).toEqual({
      mode: 'bypass',
      sandbox: 'none',
    });
  });

  it('defaults agentMode to agent', () => {
    expect(resolvePreset('auto')).toEqual(resolvePreset('auto', 'agent'));
  });
});

describe('modeToPreset', () => {
  it('maps auto → auto', () => {
    expect(modeToPreset('auto')).toBe('auto');
  });

  it('maps ask-all → ask', () => {
    expect(modeToPreset('ask-all')).toBe('ask');
  });

  it('maps bypass → yolo', () => {
    expect(modeToPreset('bypass')).toBe('yolo');
  });

  it('is the inverse of resolvePreset for all presets (agent mode)', () => {
    const presets: PermissionPreset[] = ['ask', 'auto', 'yolo'];
    for (const preset of presets) {
      const resolved = resolvePreset(preset, 'agent');
      expect(modeToPreset(resolved.mode)).toBe(preset);
    }
  });
});

describe('createEmptyRuleSet', () => {
  it('returns empty buckets', () => {
    expect(createEmptyRuleSet()).toEqual({ deny: [], ask: [], allow: [] });
  });
});

describe('mergeRuleSets', () => {
  it('concatenates per bucket preserving order', () => {
    const a = { deny: [denyRule], ask: [], allow: [allowRule] };
    const b = { deny: [], ask: [askRule], allow: [] };

    expect(mergeRuleSets(a, b)).toEqual({
      deny: [denyRule],
      ask: [askRule],
      allow: [allowRule],
    });
  });

  it('returns empty buckets for no inputs', () => {
    expect(mergeRuleSets()).toEqual({ deny: [], ask: [], allow: [] });
  });

  it('merges multiple rule sets', () => {
    const a = { deny: [denyRule], ask: [], allow: [] };
    const b = { deny: [], ask: [askRule], allow: [] };
    const c = { deny: [], ask: [], allow: [allowRule] };

    const merged = mergeRuleSets(a, b, c);
    expect(merged.deny).toHaveLength(1);
    expect(merged.ask).toHaveLength(1);
    expect(merged.allow).toHaveLength(1);
  });
});

describe('mergeAgentModeIntoPrompt', () => {
  it('uses a compact marker for the generation-scoped default agent contract', () => {
    const out = mergeAgentModeIntoPrompt('agent', 'hello');
    expect(out).toBe('[piwin-mode:agent]\nUser:\nhello');
    expect(out).not.toContain('Operating contract');
  });

  it('prefixes plan mode with non-mutating constraints', () => {
    const out = mergeAgentModeIntoPrompt('plan', 'build auth');
    expect(out).toContain('[piwin-mode:plan]');
    expect(out).toContain('Plan Mode');
    expect(out).toContain('piwin_plan_create');
    expect(out).toContain('durable artifact');
    expect(out).toContain('build auth');
  });

  it('prefixes goal mode with autonomous iteration and verification contracts', () => {
    const out = mergeAgentModeIntoPrompt('goal', 'refactor auth and verify');
    expect(out).toContain('[piwin-mode:goal]');
    expect(out).toContain('Goal Mode');
    expect(out).toContain('goal_complete');
    expect(out).toContain('goal_blocked');
    expect(out).toContain('refactor auth and verify');
  });
});

