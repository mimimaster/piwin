import { describe, expect, it } from 'vitest';
import type { ExtensionDeploymentRecord, SessionPlan, ThemeManifest } from '@piwin/contracts';
import {
  cacheSessionPlan,
  describeExtensionDeploymentFailure,
  resolveShellHostReady,
  resolveThemeBootstrapResponse,
  selectSessionPlan,
  shouldAnnounceExtensionDeploymentFailure,
  toPermissionPromptUi,
} from './use-host-bootstrap';
import { MAX_EXTENSION_DEPLOYMENT_ANNOUNCEMENTS, MAX_SESSION_PLAN_CACHE } from '../record-budget';
import {
  PIWIN_APPEARANCE_DARK,
  PIWIN_APPEARANCE_LIGHT,
} from '../appearance-tokens';

describe('resolveShellHostReady', () => {
  it('keeps remote shells online on hello when host/status enrichment fails', () => {
    expect(
      resolveShellHostReady({
        transport: 'remote',
        wireReady: true,
        statusSuccess: false,
      }),
    ).toBe(true);
  });

  it('still requires host/status for local sidecar admission', () => {
    expect(
      resolveShellHostReady({
        transport: 'live',
        wireReady: true,
        statusSuccess: false,
      }),
    ).toBe(false);
  });
});

describe('describeExtensionDeploymentFailure', () => {
  const record = (
    phase: ExtensionDeploymentRecord['phase'],
    error?: string,
  ): ExtensionDeploymentRecord => ({
    deploymentId: 'deploy-1',
    sessionId: 'session-1',
    targetRegistryRevision: 'rev-1',
    when: 'after-current-run',
    phase,
    ...(error !== undefined ? { error } : {}),
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
  });

  it('reports a rolled-back background deployment with its error', () => {
    const message = describeExtensionDeploymentFailure(record('rolled-back', 'compile exploded'));
    expect(message).toContain('rolled back');
    expect(message).toContain('compile exploded');
  });

  it('reports restart-required so the user learns action is needed', () => {
    const message = describeExtensionDeploymentFailure(record('restart-required'));
    expect(message).toMatch(/restart/i);
  });

  it('stays quiet for in-flight, transient-failed, and successful phases', () => {
    expect(describeExtensionDeploymentFailure(record('waiting-current-run'))).toBeNull();
    expect(describeExtensionDeploymentFailure(record('compiling'))).toBeNull();
    // `failed` is always followed by a terminal rolled-back/restart-required
    // write; reacting to both would double-report the same failure.
    expect(describeExtensionDeploymentFailure(record('failed', 'x'))).toBeNull();
    expect(describeExtensionDeploymentFailure(record('active'))).toBeNull();
  });

  it('reports superseded so the user learns the apply was overtaken', () => {
    const message = describeExtensionDeploymentFailure(record('superseded'));
    expect(message).toMatch(/cover|覆盖|supersed/i);
  });
});

describe('shouldAnnounceExtensionDeploymentFailure', () => {
  const record = (
    phase: ExtensionDeploymentRecord['phase'],
    deploymentId = 'deploy-1',
  ): ExtensionDeploymentRecord => ({
    deploymentId,
    sessionId: 'session-1',
    targetRegistryRevision: 'rev-1',
    when: 'after-current-run',
    phase,
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
  });

  it('announces a terminal failure once per deploymentId and phase', () => {
    const seen = new Set<string>();
    expect(shouldAnnounceExtensionDeploymentFailure(seen, record('rolled-back'))).toBe(true);
    expect(shouldAnnounceExtensionDeploymentFailure(seen, record('rolled-back'))).toBe(false);
    expect(shouldAnnounceExtensionDeploymentFailure(seen, record('superseded'))).toBe(true);
    expect(shouldAnnounceExtensionDeploymentFailure(seen, record('superseded'))).toBe(false);
  });

  it('does not announce successful or in-flight phases', () => {
    const seen = new Set<string>();
    expect(shouldAnnounceExtensionDeploymentFailure(seen, record('active'))).toBe(false);
    expect(shouldAnnounceExtensionDeploymentFailure(seen, record('waiting-current-run'))).toBe(
      false,
    );
  });

  it('caps remembered deployment announcement keys', () => {
    const seen = new Set<string>();
    for (let index = 0; index < MAX_EXTENSION_DEPLOYMENT_ANNOUNCEMENTS + 5; index += 1) {
      expect(
        shouldAnnounceExtensionDeploymentFailure(seen, record('rolled-back', `deploy-${index}`)),
      ).toBe(true);
    }
    expect(seen.size).toBe(MAX_EXTENSION_DEPLOYMENT_ANNOUNCEMENTS);
  });
});

describe('toPermissionPromptUi', () => {
  it('preserves the complete runId from a permission push', () => {
    const prompt = toPermissionPromptUi({
      type: 'permission/request',
      sessionId: 'session-1',
      requestId: 'permission-1',
      runId: 'run-with-full-identity-1234567890',
      action: 'bash',
      detail: 'rm -rf build',
      defaultDecision: 'ask',
    });

    expect(prompt.runId).toBe('run-with-full-identity-1234567890');
  });
});

describe('resolveThemeBootstrapResponse', () => {
  // Pure normalization: this module runs in a Node environment with no
  // `document`, which itself proves the bootstrap theme path never calls
  // applyAppearanceToDocument — DesktopThemeRoot owns document projection.
  it('resolves a stale built-in manifest to the desktop-owned appearance', () => {
    const staleLight: ThemeManifest = {
      ...PIWIN_APPEARANCE_LIGHT,
      version: '0.0.1',
      tokens: { ...PIWIN_APPEARANCE_LIGHT.tokens, bg: '#123456' },
    };

    const resolved = resolveThemeBootstrapResponse({
      type: 'response',
      command: 'theme/get-active',
      success: true,
      data: { theme: staleLight },
    });

    expect(resolved).toBe(PIWIN_APPEARANCE_LIGHT);
  });

  it('passes custom themes through unchanged', () => {
    const customTheme: ThemeManifest = {
      ...PIWIN_APPEARANCE_DARK,
      id: 'community-nord',
      name: 'Nord',
      tokens: { ...PIWIN_APPEARANCE_DARK.tokens, accent: '#88c0d0' },
    };

    const resolved = resolveThemeBootstrapResponse({
      type: 'response',
      command: 'theme/get-active',
      success: true,
      data: { theme: customTheme },
    });

    expect(resolved).toBe(customTheme);
  });

  it('falls back to built-in dark when the host request fails', () => {
    const resolved = resolveThemeBootstrapResponse({
      type: 'response',
      command: 'theme/get-active',
      success: false,
      error: 'theme store unavailable',
    });

    expect(resolved).toBe(PIWIN_APPEARANCE_DARK);
  });

  it('falls back to built-in dark when the response payload has no theme', () => {
    const resolved = resolveThemeBootstrapResponse({
      type: 'response',
      command: 'theme/get-active',
      success: true,
      data: {},
    });

    expect(resolved).toBe(PIWIN_APPEARANCE_DARK);
  });
});

describe('session plan cache', () => {
  const now = '2026-08-11T00:00:00.000Z';
  const plan = (sessionId: string, id: string): SessionPlan => ({
    id,
    sessionId,
    projectPath: `/tmp/${sessionId}`,
    status: 'draft',
    title: id,
    goal: 'Keep plan state session-scoped',
    steps: [{ id: '1', title: 'Verify', status: 'pending' }],
    revision: 0,
    createdAt: now,
    updatedAt: now,
    source: 'skill',
    skillId: 'writing-plans',
  });

  it('does not project a background session push into the active session', () => {
    const first = plan('session-1', 'plan-1');
    const second = plan('session-2', 'plan-2');
    let cache = cacheSessionPlan({}, first.sessionId, first);
    cache = cacheSessionPlan(cache, second.sessionId, second);

    expect(selectSessionPlan(cache, 'session-1')).toBe(first);
    expect(selectSessionPlan(cache, 'session-2')).toBe(second);
    expect(selectSessionPlan(cache, 'session-3')).toBeNull();
  });

  it('keeps a restored null plan scoped to its own session', () => {
    const first = plan('session-1', 'plan-1');
    let cache = cacheSessionPlan({}, first.sessionId, first);
    cache = cacheSessionPlan(cache, 'session-2', null);

    expect(selectSessionPlan(cache, 'session-1')).toBe(first);
    expect(selectSessionPlan(cache, 'session-2')).toBeNull();
    expect(selectSessionPlan(cache, null)).toBeNull();
  });

  it('evicts the oldest plan and keeps the protected active session', () => {
    let cache: Record<string, SessionPlan | null> = {};
    cache = cacheSessionPlan(cache, 'keep-active', plan('keep-active', 'active-plan'));
    for (let index = 0; index < MAX_SESSION_PLAN_CACHE; index += 1) {
      cache = cacheSessionPlan(
        cache,
        `session-${index}`,
        plan(`session-${index}`, `plan-${index}`),
        'keep-active',
      );
    }
    expect(Object.keys(cache)).toHaveLength(MAX_SESSION_PLAN_CACHE);
    expect(cache['keep-active']?.id).toBe('active-plan');
    expect(cache['session-0']).toBeUndefined();
  });
});
