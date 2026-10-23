import { describe, expect, it } from 'vitest';
import { citeDomainLabel, citeFavInitials } from './citation-domain.js';

describe('citeDomainLabel', () => {
  it('strips www and keeps the host', () => {
    expect(citeDomainLabel('https://www.github.com/path')).toBe('github.com');
    expect(citeDomainLabel('https://docs.claude.com/x')).toBe('docs.claude.com');
  });
});

describe('citeFavInitials', () => {
  it('matches proto-01 monograms', () => {
    expect(citeFavInitials('github.com')).toBe('GH');
    expect(citeFavInitials('docs.claude.com')).toBe('CL');
    expect(citeFavInitials('zed.dev')).toBe('Z');
  });
});
