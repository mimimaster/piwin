import { buildArtifactBridgeBootstrapScript, parseArtifactActionMessage } from '@piwin/artifact';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('artifact download runtime', () => {
  const windows: Window[] = [];
  afterEach(async () => {
    await Promise.all(windows.splice(0).map((frame) => frame.happyDOM.close()));
  });

  function boot() {
    const frame = new Window({ url: 'https://artifact.test/' });
    windows.push(frame);
    const posted: unknown[] = [];
    frame.parent.postMessage = (message: unknown) => {
      posted.push(message);
    };
    const source = buildArtifactBridgeBootstrapScript('download-frame', false)
      .replace(/^\s*<script[^>]*>/, '')
      .replace(/<\/script>\s*$/, '');
    frame.eval(source);
    const actions = () =>
      posted.map(parseArtifactActionMessage).filter((action) => action !== null);
    return { frame, actions };
  }

  it('saves the data URL from a real link click', async () => {
    const { frame, actions } = boot();
    frame.document.body.innerHTML =
      '<a href="data:image/png;base64,AQID" download="cat.png"><span>下载</span></a>';
    const click = new frame.MouseEvent('click', { bubbles: true, cancelable: true });
    frame.document.querySelector('span')?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await vi.waitFor(() =>
      expect(actions()).toEqual([
        expect.objectContaining({
          action: 'artifact/download',
          payload: { filename: 'cat.png', dataUrl: 'data:image/png;base64,AQID' },
        }),
      ]),
    );
  });

  it('reads a generated Blob even when its URL is revoked immediately after click', async () => {
    const { frame, actions } = boot();
    const blob = new frame.Blob(['cat'], { type: 'image/png' });
    const url = frame.URL.createObjectURL(blob);
    const anchor = frame.document.createElement('a');
    anchor.href = url;
    anchor.download = 'cat.png';
    anchor.click();
    frame.URL.revokeObjectURL(url);
    await vi.waitFor(() =>
      expect(actions()).toEqual([
        expect.objectContaining({
          action: 'artifact/download',
          payload: { filename: 'cat.png', dataUrl: 'data:image/png;base64,Y2F0' },
        }),
      ]),
    );
  });

  it('handles URI-encoded text and opens HTTP downloads in the browser', async () => {
    const { frame, actions } = boot();
    const anchor = frame.document.createElement('a');
    anchor.href = 'data:text/plain;charset=utf-8,%E7%8C%AB';
    anchor.download = 'cat.txt';
    anchor.click();
    await vi.waitFor(() =>
      expect(actions()[0]).toMatchObject({
        action: 'artifact/download',
        payload: { filename: 'cat.txt', dataUrl: 'data:text/plain;base64,54yr' },
      }),
    );
    anchor.href = 'https://example.com/cat.png';
    anchor.click();
    expect(actions()[1]).toMatchObject({
      action: 'artifact/open-link',
      payload: { url: 'https://example.com/cat.png' },
    });
  });

  it('reports a bounded failure for oversized bytes and unreadable URLs', () => {
    const { frame, actions } = boot();
    const blob = new frame.Blob([new Uint8Array(8 * 1024 * 1024 + 1)]);
    const anchor = frame.document.createElement('a');
    anchor.href = frame.URL.createObjectURL(blob);
    anchor.download = 'large.bin';
    anchor.click();
    expect(actions()[0]).toMatchObject({
      action: 'artifact/download-unsupported',
      payload: { reason: 'too-large' },
    });
    anchor.href = 'file:///etc/passwd';
    anchor.click();
    expect(actions()[1]).toMatchObject({
      action: 'artifact/download-unsupported',
      payload: { reason: 'unsupported-url' },
    });
  });
});
