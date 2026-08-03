import { describe, expect, it } from 'vitest';
import { maskSecretPreview } from './web-secret-editor';

describe('maskSecretPreview', () => {
  it('shows only the final four characters of a saved key', () => {
    expect(maskSecretPreview('tvly-dev-example-6GJ')).toBe('••••••••-6GJ');
    expect(maskSecretPreview('tvly-dev-example-6GJ')).toMatch(/^••••••••.{4}$/u);
    expect(maskSecretPreview('tvly-dev-example-6GJ')).not.toContain('tvly-dev-example');
  });
});
