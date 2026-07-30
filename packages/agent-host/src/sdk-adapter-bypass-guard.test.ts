import { describe, expect, it } from 'vitest';
import { resolveBypassGuard } from './sdk-adapter.js';

describe('resolveBypassGuard', () => {
  it('downgrades bypass to auto for an untrusted project', () => {
    expect(resolveBypassGuard('bypass', true, false)).toEqual({
      effectiveMode: 'auto',
      downgraded: true,
    });
  });

  it('keeps bypass for a trusted project', () => {
    expect(resolveBypassGuard('bypass', true, true)).toEqual({
      effectiveMode: 'bypass',
      downgraded: false,
    });
  });

  it('keeps bypass for general scope (no project)', () => {
    expect(resolveBypassGuard('bypass', false, false)).toEqual({
      effectiveMode: 'bypass',
      downgraded: false,
    });
  });

  it('passes auto through unchanged regardless of trust', () => {
    expect(resolveBypassGuard('auto', true, false)).toEqual({
      effectiveMode: 'auto',
      downgraded: false,
    });
    expect(resolveBypassGuard('auto', false, false)).toEqual({
      effectiveMode: 'auto',
      downgraded: false,
    });
  });

  it('passes ask-all through unchanged regardless of trust', () => {
    expect(resolveBypassGuard('ask-all', true, false)).toEqual({
      effectiveMode: 'ask-all',
      downgraded: false,
    });
  });
});
