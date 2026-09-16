import { describe, expect, it } from 'vitest';
import {
  isExtensionBlueprintEligible,
  type ExtensionCompatibility,
} from './extension-compatibility.js';

describe('isExtensionBlueprintEligible', () => {
  it('allows compatible and degraded Agent extensions', () => {
    expect(isExtensionBlueprintEligible({ tier: 'compatible' })).toBe(true);
    expect(isExtensionBlueprintEligible({ tier: 'degraded' })).toBe(true);
    expect(isExtensionBlueprintEligible({ tier: 'incompatible' })).toBe(false);
    expect(isExtensionBlueprintEligible({ tier: 'unverified' })).toBe(false);
    expect(isExtensionBlueprintEligible(undefined)).toBe(false);
  });

  it('blocks degraded extensions whose scan found only dialog UI', () => {
    expect(
      isExtensionBlueprintEligible({
        tier: 'degraded',
        capabilities: {
          tools: [],
          hooks: [],
          dialogs: ['confirm'],
        },
      }),
    ).toBe(false);
    expect(
      isExtensionBlueprintEligible({
        tier: 'degraded',
        capabilities: {
          tools: ['agent_tool'],
          hooks: [],
          dialogs: ['confirm'],
        },
      }),
    ).toBe(true);
  });

  it('keeps the compatibility document small', () => {
    const compat: ExtensionCompatibility = { tier: 'compatible' };
    expect(Object.keys(compat)).toEqual(['tier']);
  });
});
