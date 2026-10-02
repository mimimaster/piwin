import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HOST_TOOL_PERMISSION_ACTIONS, type HostToolRegistration } from '@piwin/contracts';
import { createDefaultPiwinConfig, loadPiwinConfig, savePiwinConfig } from './config-store.js';
import { effectivePermissionMode } from './effective-permission-mode.js';
import { createBundledRuleSet } from './permission-defaults.js';
import { createHostToolAdmission, resolveHostToolAdmission } from './tools/tool-admission.js';

// Strings are classified only. These tests never execute the example commands.
const context = { sessionId: 's1', runtimeGenerationId: 'g1', runId: 'r1', toolName: 'probe' };
function registration(action: string): HostToolRegistration {
  return {
    descriptor: { name: 'probe', description: 'permission probe', parameters: { type: 'object' } },
    family: 'shell',
    permissionSpec: { action, risk: 'unknown', rememberable: false, subjectBuilder: () => ({ kind: 'bash', command: 'rm -rf /' }) },
    execute: async () => { throw new Error('must not execute'); },
  };
}

describe('explicit true YOLO', () => {
  it('round trips unrestricted config without silently reverting to ordinary YOLO', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-true-yolo-'));
    try {
      const config = createDefaultPiwinConfig();
      config.permissions = { mode: 'unrestricted', preset: 'yolo' };
      await savePiwinConfig(config, root);
      expect((await loadPiwinConfig(root)).permissions).toEqual(config.permissions);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not trust-downgrade an explicit unrestricted selection', () => {
    expect(effectivePermissionMode({ configMode: 'unrestricted', projectPath: '/repo', projectTrusted: false })).toBe('unrestricted');
  });

  it('upgrades composer/child YOLO dynamically, but keeps Auto/Ask session overrides', () => {
    const base = { configMode: 'unrestricted' as const, projectPath: '/repo', projectTrusted: false };
    expect(effectivePermissionMode({ ...base, sessionOverride: 'bypass' })).toBe('unrestricted');
    expect(effectivePermissionMode({ ...base, sessionOverride: 'auto' })).toBe('auto');
    expect(effectivePermissionMode({ ...base, sessionOverride: 'ask-all' })).toBe('ask-all');
    expect(effectivePermissionMode({ ...base, cliOverride: 'auto' })).toBe('auto');
    expect(effectivePermissionMode({ ...base, cliOverride: 'bypass' })).toBe('auto');
    expect(effectivePermissionMode({ ...base, configMode: 'bypass', sessionOverride: 'bypass' })).toBe('auto');
  });

  it.each([...HOST_TOOL_PERMISSION_ACTIONS, 'unknown:mutate'])(
    'skips permission rules/prompts for %s without executing a tool', async (action) => {
      const requestPermission = vi.fn(async () => 'deny' as const);
      const admission = createHostToolAdmission({
        rules: createBundledRuleSet(), getPermissionMode: () => 'unrestricted', projectRoot: '/repo', requestPermission,
      });
      const decision = await resolveHostToolAdmission({ admission, registration: registration(action), args: {}, context, signal: new AbortController().signal });
      expect(decision).toEqual({ allowed: true });
      expect(requestPermission).not.toHaveBeenCalled();
    },
  );

  it('does not change ordinary YOLO deny behavior', async () => {
    const admission = createHostToolAdmission({ rules: createBundledRuleSet(), getPermissionMode: () => 'bypass', projectRoot: '/repo' });
    expect(await resolveHostToolAdmission({ admission, registration: registration('bash'), args: {}, context, signal: new AbortController().signal })).toMatchObject({ allowed: false });
  });
});
