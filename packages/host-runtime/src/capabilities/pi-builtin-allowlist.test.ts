import { describe, expect, it } from 'vitest';
import { FAMILY_PI_BUILTIN_TOOLS } from './tool-policy-resolver.js';

const FORBIDDEN_PI_BUILTINS = ['write', 'edit', 'bash', 'execute'];

describe('Pi built-in tool allowlist', () => {
  it('keeps the default coding read family exact', () => {
    expect(FAMILY_PI_BUILTIN_TOOLS['filesystem-read']).toEqual(['read', 'grep', 'ls']);
  });

  it('never exposes Pi-native write or shell built-ins', () => {
    for (const [family, names] of Object.entries(FAMILY_PI_BUILTIN_TOOLS)) {
      for (const forbidden of FORBIDDEN_PI_BUILTINS) {
        expect(names, `${family} contains ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
