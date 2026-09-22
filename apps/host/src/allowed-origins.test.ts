import { describe, expect, it } from 'vitest';
import { parseHostAllowedOrigins } from './allowed-origins.js';

describe('parseHostAllowedOrigins', () => {
  it('leaves the Host default when unset or blank', () => {
    expect(parseHostAllowedOrigins(undefined)).toBeUndefined();
    expect(parseHostAllowedOrigins('  ')).toBeUndefined();
  });

  it('parses a comma-separated exact Origin list', () => {
    expect(
      parseHostAllowedOrigins(
        ' https://ui.example ,http://127.0.0.1:1420, ',
      ),
    ).toEqual(['https://ui.example', 'http://127.0.0.1:1420']);
  });

  it('accepts a private-network wildcard', () => {
    expect(parseHostAllowedOrigins('*')).toEqual(['*']);
  });

  it('rejects paths, credentials, and non-http schemes', () => {
    expect(() => parseHostAllowedOrigins('https://ui.example/app')).toThrow(
      'not an Origin',
    );
    expect(() => parseHostAllowedOrigins('https://user:pw@ui.example')).toThrow(
      'not an Origin',
    );
    expect(() => parseHostAllowedOrigins('ws://127.0.0.1:8787')).toThrow(
      'not an Origin',
    );
  });
});
