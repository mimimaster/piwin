/**
 * Summary projections: only verified inputs, and no secrets in chrome.
 */
import { describe, expect, it } from 'vitest';
import { displayHostEndpoint } from './session-summary-binding';

describe('displayHostEndpoint', () => {
  it('keeps the address and drops the query', () => {
    expect(displayHostEndpoint('wss://host.example:8790')).toBe('wss://host.example:8790');
    expect(displayHostEndpoint('wss://host.example:8790/?token=secret')).toBe(
      'wss://host.example:8790/',
    );
    expect(displayHostEndpoint('wss://host.example/?pair=123#frag')).toBe(
      'wss://host.example/',
    );
    expect(displayHostEndpoint('  127.0.0.1:8787  ')).toBe('127.0.0.1:8787');
  });
});
