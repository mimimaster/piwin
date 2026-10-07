import { describe, expect, it, vi } from 'vitest';
import { prioritizeCompactionHooks } from './compaction-hook-priority.js';

type Handler = (event: unknown, ctx: unknown) => unknown;

function loaderWith(extensions: Array<{ path: string; handlers: Map<string, Handler[]> }>) {
  return { getExtensions: () => ({ extensions }) };
}

function extension(path: string, handler?: Handler) {
  return {
    path,
    handlers: new Map<string, Handler[]>(handler ? [['session_before_compact', [handler]]] : []),
  };
}

/** Mirrors Pi's ExtensionRunner.emit for session_before_* events: last result wins. */
async function emitLikePi(loader: ReturnType<typeof loaderWith>): Promise<unknown> {
  let result: unknown;
  for (const ext of loader.getExtensions().extensions) {
    for (const handler of ext.handlers.get('session_before_compact') ?? []) {
      const handlerResult = await handler({}, {});
      if (handlerResult) result = handlerResult;
    }
  }
  return result;
}

describe('prioritizeCompactionHooks', () => {
  it('lets the preferred extension win and skips the others', async () => {
    const community = vi.fn(() => ({ compaction: { summary: 'community' } }));
    const bundled = vi.fn(() => ({ compaction: { summary: 'bundled' } }));
    const loader = loaderWith([
      extension('/root/extensions/pi-deepseek-cache', bundled),
      extension('/root/extensions/revisions/pi-cc-compact/abc/source', community),
    ]);

    prioritizeCompactionHooks(loader, ['/root/extensions/pi-deepseek-cache']);

    expect(await emitLikePi(loader)).toEqual({ compaction: { summary: 'bundled' } });
    expect(community).not.toHaveBeenCalled();
  });

  it('falls through to the next extension when the preferred one declines', async () => {
    const bundled = vi.fn(() => undefined);
    const loader = loaderWith([
      extension('/root/extensions/revisions/a-compactor/abc/source', () => ({
        compaction: { summary: 'community' },
      })),
      extension('/root/extensions/pi-deepseek-cache', bundled),
    ]);

    prioritizeCompactionHooks(loader, ['/root/extensions/pi-deepseek-cache']);

    expect(await emitLikePi(loader)).toEqual({ compaction: { summary: 'community' } });
    expect(bundled).toHaveBeenCalledTimes(1);
  });

  it('skips a throwing handler and keeps going', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loader = loaderWith([
      extension('/root/extensions/pi-deepseek-cache', () => {
        throw new Error('boom');
      }),
      extension('/root/extensions/revisions/x/abc/source', () => ({ cancel: true })),
    ]);

    prioritizeCompactionHooks(loader, ['/root/extensions/pi-deepseek-cache']);

    expect(await emitLikePi(loader)).toEqual({ cancel: true });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('leaves a single compaction extension untouched', () => {
    const handler = vi.fn();
    const only = extension('/root/extensions/revisions/x/abc/source', handler);
    const loader = loaderWith([extension('/root/extensions/goal.ts'), only]);

    prioritizeCompactionHooks(loader, []);

    expect(only.handlers.get('session_before_compact')).toEqual([handler]);
  });
});
