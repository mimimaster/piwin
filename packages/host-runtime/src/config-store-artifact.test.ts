import { describe, expect, it } from 'vitest';
import { createDefaultArtifactConfig } from '@piwin/contracts';
import { normalizeArtifactConfig } from './config-store-artifact.js';

describe('artifact config styleModes (internal switch)', () => {
  it('keeps host-only and drops anything else', () => {
    const defaults = createDefaultArtifactConfig();
    expect(normalizeArtifactConfig({ styleModes: 'host-only' }, defaults).styleModes).toBe('host-only');
    expect(normalizeArtifactConfig({ styleModes: 'model' }, defaults).styleModes).toBeUndefined();
    expect(normalizeArtifactConfig({ styleModes: 'wild' }, defaults).styleModes).toBeUndefined();
    expect(normalizeArtifactConfig({}, defaults)).not.toHaveProperty('styleModes');
  });
});
