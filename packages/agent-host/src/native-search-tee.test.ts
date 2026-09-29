import { describe, expect, it } from 'vitest';
import { createNativeSearchTee } from './native-search-tee.js';

describe('native search fetch tee', () => {
  it('returns the real response to Pi and keeps only the last 2xx body', async () => {
    const responses = [
      new Response('first-ok', { status: 200 }),
      new Response('rate limited', { status: 429 }),
      new Response('final-ok', { status: 200 }),
    ];
    const tee = createNativeSearchTee(async () => {
      const next = responses.shift();
      if (!next) throw new Error('no response');
      return next;
    });
    const first = await tee.fetch('https://api.example/v1/responses');
    expect(await first.text()).toBe('first-ok');
    await tee.fetch('https://api.example/v1/responses');
    const last = await tee.fetch('https://api.example/v1/responses');
    expect(await last.text()).toBe('final-ok');
    expect(await tee.lastSuccessfulBody()).toBe('final-ok');
  });

  it('reports no body when nothing succeeded', async () => {
    const tee = createNativeSearchTee(async () => new Response('nope', { status: 500 }));
    await tee.fetch('https://api.example');
    expect(await tee.lastSuccessfulBody()).toBeUndefined();
  });
});
