import { describe, expect, it } from 'vitest';
import { parseExtensionModelProviderClaim } from './subscription-oauth.js';

describe('public provider presentation claim', () => {
  it('trims an optional plain-text availability notice', () => {
    expect(parseExtensionModelProviderClaim({ modelProvider: {
      id: 'acme', auth: 'none', name: ' Acme ', notice: ' Availability depends on IP ',
    } })).toEqual({ id: 'acme', auth: 'none', name: 'Acme', notice: 'Availability depends on IP' });
  });
  it.each([false, {}, '', ' ', 'x'.repeat(4097)])('rejects an invalid notice: %j', (notice) => {
    expect(parseExtensionModelProviderClaim({ modelProvider: { id: 'acme', auth: 'none', notice } })).toBe('invalid');
  });
});
