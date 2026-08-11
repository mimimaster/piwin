import { describe, expect, it } from 'vitest';
import type { SessionPlan, ThemeManifest } from '@piwin/contracts';
import {
  cacheSessionPlan,
  resolveThemeBootstrapResponse,
  selectSessionPlan,
  toPermissionPromptUi,
} from './use-host-bootstrap';
import {
  PIWIN_APPEARANCE_DARK,
  PIWIN_APPEARANCE_LIGHT,
} from '../appearance-tokens';

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
});
