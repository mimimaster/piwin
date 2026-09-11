import { describe, expect, it } from 'vitest';
import {
  isExtensionBlueprintEligible,
  type ExtensionCompatibility,
} from './extension-compatibility.js';

describe('isExtensionBlueprintEligible', () => {
  it('allows only the compatible tier', () => {
    expect(isExtensionBlueprintEligible({ tier: 'compatible' })).toBe(true);
    expect(isExtensionBlueprintEligible({ tier: 'degraded' })).toBe(false);
    expect(isExtensionBlueprintEligible({ tier: 'incompatible' })).toBe(false);
    expect(isExtensionBlueprintEligible({ tier: 'unverified' })).toBe(false);
    expect(isExtensionBlueprintEligible(undefined)).toBe(false);
  });

  it('keeps the compatibility document small', () => {
    const compat: ExtensionCompatibility = { tier: 'compatible' };
    expect(Object.keys(compat)).toEqual(['tier']);
  });
});
