import { describe, expect, it } from 'vitest';
import type { PermissionRuleSet } from '@piwin/contracts';
import { evaluateBrowserNavigatePermission } from './browser-navigate-permission.js';
import { createBundledRuleSet } from './permission-defaults.js';

describe('evaluateBrowserNavigatePermission', () => {
  it('denies empty url', () => {
    expect(evaluateBrowserNavigatePermission('')).toEqual({
      decision: 'deny',
      reason: 'empty-url',
    });
  });

  it('denies invalid url', () => {
    expect(evaluateBrowserNavigatePermission('not-a-url')).toEqual({
      decision: 'deny',
      reason: 'invalid-url',
    });
  });

  it('denies non-http schemes', () => {
    expect(evaluateBrowserNavigatePermission('file:///etc/passwd').decision).toBe('deny');
    expect(evaluateBrowserNavigatePermission('javascript:alert(1)').decision).toBe('deny');
  });

  it('allows loopback localhost by default', () => {
    const result = evaluateBrowserNavigatePermission('http://localhost:3000');
    expect(result.decision).toBe('allow');
    expect(result.reason).toBe('loopback-allowed');
  });

  it('allows 127.0.0.1 by default', () => {
    expect(evaluateBrowserNavigatePermission('http://127.0.0.1:8080').decision).toBe('allow');
  });

  it('allows ::1 by default', () => {
    expect(evaluateBrowserNavigatePermission('http://[::1]:8080').decision).toBe('allow');
    expect(evaluateBrowserNavigatePermission('http://[::ffff:7f00:1]:8080').decision).toBe('allow');
  });

  it('allows *.localhost by default', () => {
    expect(evaluateBrowserNavigatePermission('http://api.localhost:3000').decision).toBe('allow');
  });

  it('asks for private 10.x range', () => {
    const result = evaluateBrowserNavigatePermission('http://10.0.0.1');
    expect(result.decision).toBe('ask');
    expect(result.reason).toContain('private-or-local');
  });

  it('asks for 192.168.x range', () => {
    expect(evaluateBrowserNavigatePermission('http://192.168.1.1').decision).toBe('ask');
  });

  it('asks for 172.16.x range', () => {
    expect(evaluateBrowserNavigatePermission('http://172.16.0.1').decision).toBe('ask');
  });

  it('asks for link-local 169.254.169.254 (cloud metadata)', () => {
    const result = evaluateBrowserNavigatePermission('http://169.254.169.254/latest/meta-data/');
    expect(result.decision).toBe('ask');
    expect(result.reason).toContain('private-or-local');
  });

  it('asks for fd00::/8 ULA', () => {
    expect(evaluateBrowserNavigatePermission('http://[fd12::1]').decision).toBe('ask');
  });

  it('asks for fe80::/10 link-local', () => {
    expect(evaluateBrowserNavigatePermission('http://[fe80::1]').decision).toBe('ask');
  });

  it('asks for public hosts by default', () => {
    const result = evaluateBrowserNavigatePermission('https://example.com');
    expect(result.decision).toBe('ask');
    expect(result.reason).toBe('navigate:example.com');
  });

  it('consults rule engine before defaults (allow rule)', () => {
    const rules: PermissionRuleSet = {
      deny: [],
      ask: [],
      allow: [
        {
          target: { kind: 'web-fetch', hostGlob: 'example.com' },
          decision: 'allow',
          reason: 'rule-allow',
        },
      ],
    };
    const result = evaluateBrowserNavigatePermission('https://example.com', rules);
    expect(result.decision).toBe('allow');
    expect(result.reason).toBe('rule-allow');
  });

  it('consults rule engine before defaults (deny rule overrides loopback)', () => {
    const rules: PermissionRuleSet = {
      deny: [
        {
          target: { kind: 'web-fetch', hostGlob: 'localhost' },
          decision: 'deny',
          reason: 'rule-deny',
        },
      ],
      ask: [],
      allow: [],
    };
    const result = evaluateBrowserNavigatePermission('http://localhost:3000', rules);
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('rule-deny');
  });

  it('falls through to defaults when no rule matches', () => {
    const rules = createBundledRuleSet();
    const result = evaluateBrowserNavigatePermission('http://localhost:3000', rules);
    expect(result.decision).toBe('allow');
  });
});
