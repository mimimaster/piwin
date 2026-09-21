import { describe, expect, it } from 'vitest';
import type { ArtifactConfig } from '@piwin/contracts';
import { createDefaultArtifactConfig } from '@piwin/contracts';
import {
  artifactScopeKeyForScope,
  artifactSurfaceProps,
  resolveArtifactSurfacesForScope,
} from './artifact-surfaces.js';

const GENERAL = { kind: 'general' } as const;
const PROJECT = { kind: 'project', projectPath: '/tmp/piwin-artifact-surfaces' } as const;

describe('artifact scope class', () => {
  it('maps SessionScope.kind onto the two Artifact classes', () => {
    expect(artifactScopeKeyForScope(GENERAL)).toBe('general');
    expect(artifactScopeKeyForScope(PROJECT)).toBe('project');
    // Not yet resolved (draft, hydration, Home) reads as Conversation chat.
    expect(artifactScopeKeyForScope(undefined)).toBe('general');
  });
});

describe('Desktop Artifact surfaces', () => {
  it('ships Conversation chat on and Agent chat off', () => {
    const config = createDefaultArtifactConfig();
    expect(resolveArtifactSurfacesForScope(config, GENERAL)).toEqual({
      enabled: true,
      inline: true,
      canvas: true,
    });
    expect(resolveArtifactSurfacesForScope(config, PROJECT)).toEqual({
      enabled: false,
      inline: false,
      canvas: false,
    });
  });

  it('honours an explicit per-scope opt-in and the master switch', () => {
    const config: ArtifactConfig = {
      ...createDefaultArtifactConfig(),
      scopes: {
        general: { inline: true, canvas: false },
        project: { inline: true, canvas: true },
      },
    };
    expect(resolveArtifactSurfacesForScope(config, PROJECT).canvas).toBe(true);
    expect(resolveArtifactSurfacesForScope(config, GENERAL)).toEqual({
      enabled: true,
      inline: true,
      canvas: false,
    });
    expect(resolveArtifactSurfacesForScope({ ...config, enabled: false }, PROJECT).enabled).toBe(
      false,
    );
  });

  it('missing Host config keeps the shipped default instead of disabling everything', () => {
    expect(resolveArtifactSurfacesForScope(undefined, GENERAL).canvas).toBe(true);
    expect(resolveArtifactSurfacesForScope(undefined, PROJECT).enabled).toBe(false);
  });

  it('always passes both booleans so a false survives a prop spread', () => {
    expect(artifactSurfaceProps({ enabled: false, inline: false, canvas: false })).toEqual({
      artifactInlineEnabled: false,
      artifactCanvasEnabled: false,
    });
    expect(artifactSurfaceProps({ enabled: true, inline: true, canvas: false })).toEqual({
      artifactInlineEnabled: true,
      artifactCanvasEnabled: false,
    });
  });
});
