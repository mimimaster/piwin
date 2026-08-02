import { describe, expect, it } from 'vitest';
import { validatePluginRegistry } from './registry.js';

function makeResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('validatePluginRegistry', () => {
  it('accepts a valid index', () => {
    const index = validatePluginRegistry({
      version: 1,
      plugins: [
        {
          id: 'remotion',
          name: 'Remotion',
          version: '1.0.0',
          description: 'Video',
          source: { kind: 'git', url: 'https://github.com/x/remotion-plugin' },
        },
        {
          id: 'local-thing',
          name: 'Local',
          version: '0.1.0',
          source: { kind: 'local', path: '/tmp/x' },
        },
      ],
    });
    expect(index.version).toBe(1);
    expect(index.plugins).toHaveLength(2);
    expect(index.plugins[0]?.source.kind).toBe('git');
  });

  it('rejects non-object', () => {
    expect(() => validatePluginRegistry('x')).toThrow();
  });

  it('rejects wrong version', () => {
    expect(() => validatePluginRegistry({ version: 2, plugins: [] })).toThrow();
  });

  it('rejects missing plugins array', () => {
    expect(() => validatePluginRegistry({ version: 1 })).toThrow();
  });

  it('rejects entry with bad source', () => {
    expect(() =>
      validatePluginRegistry({
        version: 1,
        plugins: [{ id: 'x', name: 'X', version: '1.0.0', source: { kind: 'bad' } }],
      }),
    ).toThrow();
  });
});

describe('fetchPluginRegistry', () => {
  it('fetches and validates', async () => {
    const { fetchPluginRegistry } = await import('./registry.js');
    const index = await fetchPluginRegistry('https://example.com/plugins.json', {
      fetch: async () =>
        makeResponse({
          version: 1,
          plugins: [
            { id: 'x', name: 'X', version: '1.0.0', source: { kind: 'git', url: 'https://x' } },
          ],
        }),
    });
    expect(index.plugins).toHaveLength(1);
  });

  it('throws on non-200 response', async () => {
    const { fetchPluginRegistry } = await import('./registry.js');
    await expect(
      fetchPluginRegistry('https://example.com/missing', {
        fetch: async () => new Response('Not Found', { status: 404 }),
      }),
    ).rejects.toThrow('404');
  });
});
