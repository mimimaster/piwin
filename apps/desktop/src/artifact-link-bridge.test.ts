// @vitest-environment happy-dom
import { buildArtifactBridgeBootstrapScript, parseArtifactActionMessage } from '@piwin/artifact';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Runs the real bootstrap script that goes into every artifact srcdoc, and
 * checks that link activation is turned into an open-link action for the
 * host (the sandbox itself has no allow-popups / allow-top-navigation).
 */
describe('artifact sandbox links', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function boot(): { actions: () => unknown[] } {
    const posted: unknown[] = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(message);
    });
    // eslint-disable-next-line no-new-func
    const source = buildArtifactBridgeBootstrapScript('fence-1', false).replace(/^\s*<script[^>]*>/, '').replace(/<\/script>\s*$/, '');
    new Function(source)();
    return {
      actions: () =>
        posted.map((message) => parseArtifactActionMessage(message)).filter((action) => action !== null),
    };
  }

  it('hands external links (target=_blank or not) to the host and cancels in-frame navigation', () => {
    const { actions } = boot();
    document.body.innerHTML =
      '<a id="a" href="https://github.com/x" target="_blank"><span id="inner">直接看 ↗</span></a><a id="m" href="mailto:a@b.c">mail</a>';
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('inner')?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    document.getElementById('m')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(actions()).toEqual([
      expect.objectContaining({ action: 'artifact/open-link', payload: { url: 'https://github.com/x' } }),
      expect.objectContaining({ action: 'artifact/open-link', payload: { url: 'mailto:a@b.c' } }),
    ]);
  });

  it('leaves in-page anchors and unsafe schemes alone, and routes window.open', () => {
    const { actions } = boot();
    document.body.innerHTML = '<a id="h" href="#top">top</a><a id="j" href="javascript:void 0">x</a>';
    const hash = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('h')?.dispatchEvent(hash);
    expect(hash.defaultPrevented).toBe(false);
    document.getElementById('j')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(actions()).toEqual([]);
    expect(window.open('https://example.com/p')).toBeNull();
    expect(actions()).toEqual([expect.objectContaining({ action: 'artifact/open-link', payload: { url: 'https://example.com/p' } })]);
  });
});
