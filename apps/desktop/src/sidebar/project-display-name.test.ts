import { describe, expect, it } from 'vitest';
import { projectDisplayName, projectLabel } from './project-display-name';

describe('projectLabel', () => {
  it('uses Host displayName when the key is an opaque remote project id', () => {
    expect(
      projectLabel('project-3f3cd6fe3b1082e864080402', [
        {
          path: 'project-3f3cd6fe3b1082e864080402',
          displayName: 'piwin',
        },
      ]),
    ).toBe('piwin');
  });

  it('falls back to the last path segment when displayName is missing', () => {
    expect(projectLabel('/Users/test/openwebui', [])).toBe('openwebui');
    expect(projectDisplayName('/Users/test/openwebui')).toBe('openwebui');
  });
});
