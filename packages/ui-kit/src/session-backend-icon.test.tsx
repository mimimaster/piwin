import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadProviderBrandIcons } from './provider-brands.js';
import { SessionBackendIcon } from './session-backend-icon.js';

describe('SessionBackendIcon', () => {
  beforeAll(async () => {
    await loadProviderBrandIcons();
  });

  it('renders built-in brand icons and custom SVG glyphs without raw HTML', () => {
    const html = renderToStaticMarkup(
      <div>
        <SessionBackendIcon icon={{ kind: 'brand', id: 'antigravity' }} name="Antigravity" size={12} />
        <SessionBackendIcon
          icon={{
            kind: 'glyph',
            viewBox: '0 0 24 24',
            paths: ['M12 2 L22 20 L2 20 Z'],
            fillRule: 'evenodd',
          }}
          name="Custom"
          size={12}
        />
      </div>,
    );
    expect(html).toContain('data-provider-icon="antigravity"');
    expect(html).toContain('data-provider-brand="Antigravity"');
    expect(html).toContain('data-backend-icon="glyph"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('fill-rule="evenodd"');
    expect(html).toContain('d="M12 2 L22 20 L2 20 Z"');
  });
});
