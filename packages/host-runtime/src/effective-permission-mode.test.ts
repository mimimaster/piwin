import { describe, expect, it } from 'vitest';
import { effectivePermissionMode } from './effective-permission-mode.js';

describe('effectivePermissionMode', () => {
  it('keeps YOLO for trusted projects', () => {
    expect(
      effectivePermissionMode({
        configMode: 'bypass',
        projectPath: '/tmp/trusted',
        projectTrusted: true,
      }),
    ).toBe('bypass');
  });

  it('downgrades YOLO on untrusted projects', () => {
    expect(
      effectivePermissionMode({
        configMode: 'bypass',
        projectPath: '/tmp/untrusted',
        projectTrusted: false,
      }),
    ).toBe('auto');
  });

  it('does not treat a general (no-project) session as untrusted', () => {
    expect(
      effectivePermissionMode({
        configMode: 'bypass',
        projectTrusted: false,
      }),
    ).toBe('bypass');
  });

  it('keeps a Plan/Ask ask-all override even on untrusted projects', () => {
    expect(
      effectivePermissionMode({
        sessionOverride: 'ask-all',
        configMode: 'bypass',
        projectPath: '/tmp/untrusted',
        projectTrusted: false,
      }),
    ).toBe('ask-all');
  });
});
