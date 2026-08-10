import { describe, expect, it } from 'vitest';
import { validateThemeManifest } from './validate-manifest.js';

const valid = {
  id: 'demo-dark',
  name: 'Demo',
  version: '1.0.0',
  mode: 'dark',
  tokens: {
    bg: '#000000',
    panel: '#111111',
    panel2: '#222222',
    border: '#333333',
    text: '#ffffff',
    muted: '#aaaaaa',
    accent: '#6ea8fe',
    accent2: '#3d7eff',
    danger: '#ff0000',
    ok: '#00ff00',
    radius: '12px',
    font: 'system-ui, sans-serif',
  },
};

describe('validateThemeManifest', () => {
  it('accepts a valid token theme', () => {
    const result = validateThemeManifest(valid);
    expect(result.ok).toBe(true);
  });

  it('rejects executable css/js fields', () => {
    const result = validateThemeManifest({ ...valid, css: 'body{}' });
    expect(result.ok).toBe(false);
  });

  it('rejects bad id and missing tokens', () => {
    const result = validateThemeManifest({ id: 'BAD ID', name: 'x', version: '1', mode: 'dark' });
    expect(result.ok).toBe(false);
  });

  it('accepts the optional visual style without making it executable', () => {
    const result = validateThemeManifest({ ...valid, visualStyle: 'ink-wash' });
    expect(result).toMatchObject({ ok: true, manifest: { visualStyle: 'ink-wash' } });
  });

  it('rejects unknown visual styles', () => {
    const result = validateThemeManifest({ ...valid, visualStyle: 'custom-css' });
    expect(result.ok).toBe(false);
  });
});
