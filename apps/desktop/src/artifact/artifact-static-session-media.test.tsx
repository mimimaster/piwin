/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import { MarkdownView } from '../markdown/MarkdownView.js';
import { MediaPreviewReadProvider } from '../media/media-preview-read-context.js';
import { resetArtifactMediaDataUrlCacheForTests } from './artifact-session-media.js';

const SESSION_ID = 'session-static-media';
const MEDIA_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

const { limitedDataUrlFromHref, localVaultUrl } = vi.hoisted(() => ({
  limitedDataUrlFromHref: vi.fn<(href: string, maxEdgePx: number) => Promise<string | null>>(),
  localVaultUrl: vi.fn<(input: { mimeType: string }) => Promise<string | null>>(),
}));

vi.mock('./artifact-native-bridge.js', () => ({
  subscribeNativeArtifactBridge: vi.fn(async () => () => undefined),
}));

vi.mock('../media/media-preview-bitmap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../media/media-preview-bitmap')>()),
  createLimitedDataUrlFromHref: limitedDataUrlFromHref,
}));

vi.mock('../conversation/transcript-media-preview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation/transcript-media-preview')>()),
  resolveLocalVaultMediaUrl: localVaultUrl,
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// No script and style="host": the fence renders static, in the host DOM.
const STATIC_CARD_MARKDOWN = [
  '```artifact-html title="Portrait" style="host"',
  '<div class="card">',
  `  <img data-piwin-media="${MEDIA_ID}" alt="Generated portrait" />`,
  '  <p>Soft natural light</p>',
  '</div>',
  '```',
].join('\n');

describe('static artifact with a session vault image', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    resetArtifactMediaDataUrlCacheForTests();
    limitedDataUrlFromHref.mockReset();
    localVaultUrl.mockReset();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function renderCard(readMedia: (() => Promise<string | null>) | null): Promise<void> {
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MediaPreviewReadProvider sessionId={SESSION_ID} readMedia={readMedia}>
            <MarkdownView
              text={STATIC_CARD_MARKDOWN}
              renderingPhase="completed"
              locale="en"
              artifactOrigin={{ sessionId: SESSION_ID, messageId: 'message-1' }}
            />
          </MediaPreviewReadProvider>
        </PiwinUiProvider>,
      );
    });
  }

  async function readStaticImage(): Promise<HTMLImageElement | null> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const image = host
        .querySelector('[data-testid="artifact-static"]')
        ?.shadowRoot?.querySelector('img');
      if (image?.getAttribute('src')) return image;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    return (
      host.querySelector('[data-testid="artifact-static"]')?.shadowRoot?.querySelector('img') ??
      null
    );
  }

  it('paints the image from the local vault file without a Host read', async () => {
    localVaultUrl.mockResolvedValue('asset://localhost/vault.jpg');
    limitedDataUrlFromHref.mockResolvedValue(DATA_URL);
    const readMedia = vi.fn(async () => 'blob:http://localhost/vault');

    await renderCard(readMedia);

    expect(host.querySelector('[data-artifact-renderer="static-flow"]')).not.toBeNull();
    expect((await readStaticImage())?.getAttribute('src')).toBe(DATA_URL);
    expect(readMedia).not.toHaveBeenCalled();
  });

  it('falls back to the Host read when the shell has no local vault access', async () => {
    localVaultUrl.mockResolvedValue(null);
    limitedDataUrlFromHref.mockImplementation(async (href) =>
      href.startsWith('blob:') ? DATA_URL : null,
    );

    await renderCard(async () => 'blob:http://localhost/vault');

    expect((await readStaticImage())?.getAttribute('src')).toBe(DATA_URL);
  });
});
