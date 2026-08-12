import type { SessionRuntimeStatus, SettingsDomainImpact } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { SessionRuntimeController } from './session-runtime-controller.js';

function createController(runInFlight = false): SessionRuntimeController {
  return new SessionRuntimeController({ isRunInFlight: () => runInFlight });
}

function webImpact(
  immediateRestrictions: SettingsDomainImpact['immediateRestrictions'],
): SettingsDomainImpact {
  return {
    domain: 'web',
    timing: 'new-runtime',
    runtimeSchemaChanged: true,
    immediateRestrictions,
    securityTightenedImmediately: immediateRestrictions.length > 0,
  };
}

describe('SessionRuntimeController', () => {
  it('publishes normalized status after runtime mutations', () => {
    const published: SessionRuntimeStatus[] = [];
    const controller = new SessionRuntimeController({
      isRunInFlight: () => false,
      onChanged: (status) => published.push(status),
    });

    controller.attachGeneration('s1', 'gen-1', 'rev-1');
    controller.recordSettingsChange('s1', ['web']);
    controller.detachGeneration('s1');

    expect(published.map((status) => status.state)).toEqual(['live', 'stale', 'lazy-shell']);
    expect(published[1]?.staleDomains).toEqual(['web']);
  });

  it('reports lazy-shell before any generation attaches', () => {
    const controller = createController();
    expect(controller.hasActiveGeneration('s1')).toBe(false);
    expect(controller.getStatus('s1').state).toBe('lazy-shell');
  });

  it('attaching a generation marks the session live', () => {
    const controller = createController();
    controller.attachGeneration('s1', 'gen-1', 'rev-1');
    const status = controller.getStatus('s1');
    expect(status.state).toBe('live');
    expect(status.generationId).toBe('gen-1');
    expect(status.settingsRevision).toBe('rev-1');
    expect(status.staleDomains).toEqual([]);
  });

  it('Settings mutation marks only runtime-stale domains', () => {
    const controller = createController();
    controller.attachGeneration('s1', 'gen-1', 'rev-1');
    controller.recordSettingsChange('s1', ['skills', 'desktop']);
    const status = controller.getStatus('s1');
    expect(status.state).toBe('stale');
    expect(status.staleDomains).toEqual(['skills']);
  });

  it('immediate safety tightening is reported without aborting a running turn', () => {
    const controller = createController(true);
    controller.attachGeneration('s1', 'gen-1', 'rev-1');
    controller.recordSettingsChange('s1', ['permissions']);
    expect(controller.requiresImmediateTightening('s1')).toBe(true);
  });

  it('retains a prior restriction across later same-domain saves until replacement', () => {
    const controller = createController(true);
    controller.attachGeneration('s1', 'gen-1', 'rev-1');
    controller.recordSettingsChange('s1', [webImpact(['web-search'])], 'rev-2');
    controller.recordSettingsChange('s1', [webImpact([])], 'rev-3');

    expect(controller.getStatus('s1')).toMatchObject({
      desiredSettingsRevision: 'rev-3',
      immediateRestrictions: ['web-search'],
    });

    controller.attachGeneration('s1', 'gen-2', 'rev-3');
    expect(controller.getStatus('s1').immediateRestrictions).toBeUndefined();
  });

  it('reload is blocked while a run is in flight', () => {
    const controller = createController(true);
    controller.attachGeneration('s1', 'gen-1', 'rev-1');
    controller.recordSettingsChange('s1', ['web']);
    expect(controller.planReload('s1', 'rev-1')).toEqual({ allowed: false, reason: 'running' });
  });

  it('reload is blocked when the session is not stale', () => {
    const controller = createController(false);
    controller.attachGeneration('s1', 'gen-1', 'rev-1');
    expect(controller.planReload('s1', 'rev-1')).toEqual({ allowed: false, reason: 'not-stale' });
  });

  it('reload is blocked on a settings revision mismatch', () => {
    const controller = createController(false);
    controller.attachGeneration('s1', 'gen-1', 'rev-1');
    controller.recordSettingsChange('s1', ['web']);
    expect(controller.planReload('s1', 'rev-99')).toEqual({
      allowed: false,
      reason: 'revision-mismatch',
    });
  });

  it('reload is allowed when stale and not running with the recorded revision', () => {
    const controller = createController(false);
    controller.attachGeneration('s1', 'gen-1', 'rev-1');
    controller.recordSettingsChange('s1', ['web']);
    expect(controller.planReload('s1', 'rev-1')).toEqual({ allowed: true });
  });

  it('detach clears generation and pending changes', () => {
    const controller = createController(false);
    controller.attachGeneration('s1', 'gen-1', 'rev-1');
    controller.recordSettingsChange('s1', ['web']);
    controller.detachGeneration('s1');
    expect(controller.hasActiveGeneration('s1')).toBe(false);
    expect(controller.getStatus('s1').staleDomains).toEqual([]);
  });

  it('detach clears an unfinished replacement candidate', () => {
    const controller = createController(false);
    controller.attachGeneration('s1', 'gen-1', 'rev-1');
    controller.beginCandidate('s1', 'gen-2');
    controller.setCandidateState('s1', 'gen-2', 'rebuilding');

    controller.detachGeneration('s1');

    expect(controller.getStatus('s1')).toEqual({
      sessionId: 's1',
      state: 'lazy-shell',
      residency: 'cold',
      staleDomains: [],
    });
  });

  it('projects cold residency by default and retains last eviction reason', () => {
    const controller = createController();
    expect(controller.getStatus('s1').residency).toBe('cold');

    controller.attachGeneration('s1', 'gen-1', 'rev-1');
    controller.setResidency('s1', 'resident-idle');
    expect(controller.getStatus('s1').residency).toBe('resident-idle');
    expect(controller.getStatus('s1').lastEvictionReason).toBeUndefined();

    controller.setResidency('s1', 'suspending', { lastEvictionReason: 'idle-ttl' });
    expect(controller.getStatus('s1')).toMatchObject({
      residency: 'suspending',
      lastEvictionReason: 'idle-ttl',
    });

    controller.markCold('s1', 'idle-ttl');
    expect(controller.getStatus('s1')).toMatchObject({
      residency: 'cold',
      lastEvictionReason: 'idle-ttl',
    });

    // Reactivation clears the eviction explanation.
    controller.setResidency('s1', 'resident-busy');
    expect(controller.getStatus('s1').residency).toBe('resident-busy');
    expect(controller.getStatus('s1').lastEvictionReason).toBeUndefined();
  });
});
