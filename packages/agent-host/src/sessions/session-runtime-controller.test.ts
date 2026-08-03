import { describe, expect, it } from 'vitest';
import { SessionRuntimeController } from './session-runtime-controller.js';

function createController(runInFlight = false): SessionRuntimeController {
  return new SessionRuntimeController({ isRunInFlight: () => runInFlight });
}

describe('SessionRuntimeController', () => {
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
});
