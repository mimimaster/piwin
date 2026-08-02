import { describe, expect, it } from 'vitest';
import {
  resolveSubagentCapabilitiesToTools,
  isPiToolAllowed,
  isCustomToolAllowed,
} from './subagent-capability-resolver.js';

describe('resolveSubagentCapabilitiesToTools', () => {
  it('returns empty allowlist (no restriction) when capabilities undefined', () => {
    const result = resolveSubagentCapabilitiesToTools(undefined);
    expect(result.piToolNames).toEqual([]);
    expect(result.customToolNames).toEqual([]);
  });

  it('maps read capability to read/grep/find/ls', () => {
    const result = resolveSubagentCapabilitiesToTools(['read']);
    expect(result.piToolNames).toEqual(['find', 'grep', 'ls', 'read']);
    expect(result.customToolNames).toEqual([]);
  });

  it('maps write capability to write/edit', () => {
    const result = resolveSubagentCapabilitiesToTools(['write']);
    expect(result.piToolNames).toEqual(['edit', 'write']);
  });

  it('maps execute capability to bash + process tools', () => {
    const result = resolveSubagentCapabilitiesToTools(['execute']);
    expect(result.piToolNames).toEqual(['bash']);
    expect(result.customToolNames).toContain('process_start');
  });

  it('maps network capability to web_search/web_fetch', () => {
    const result = resolveSubagentCapabilitiesToTools(['network']);
    expect(result.customToolNames).toEqual(['web_fetch', 'web_search']);
  });

  it('maps planning capability to plan tools', () => {
    const result = resolveSubagentCapabilitiesToTools(['planning']);
    expect(result.customToolNames).toEqual(['piwin_plan_create', 'piwin_plan_set_step']);
  });

  it('maps delegate capability to piwin_subagent_run', () => {
    const result = resolveSubagentCapabilitiesToTools(['delegate']);
    expect(result.customToolNames).toEqual(['piwin_subagent_run']);
  });

  it('dedupes tools across capabilities', () => {
    const result = resolveSubagentCapabilitiesToTools(['read', 'write', 'execute']);
    expect(result.piToolNames).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
  });
});

describe('isPiToolAllowed / isCustomToolAllowed', () => {
  it('allows all tools when allowlist is empty (no restriction)', () => {
    const allowlist = { piToolNames: [], customToolNames: [] };
    expect(isPiToolAllowed('bash', allowlist)).toBe(true);
    expect(isCustomToolAllowed('web_search', allowlist)).toBe(true);
  });

  it('restricts pi tools to allowlist', () => {
    const allowlist = resolveSubagentCapabilitiesToTools(['read']);
    expect(isPiToolAllowed('read', allowlist)).toBe(true);
    expect(isPiToolAllowed('bash', allowlist)).toBe(false);
  });

  it('restricts custom tools to allowlist', () => {
    const allowlist = resolveSubagentCapabilitiesToTools(['network']);
    expect(isCustomToolAllowed('web_search', allowlist)).toBe(true);
    expect(isCustomToolAllowed('piwin_subagent_run', allowlist)).toBe(false);
  });
});
