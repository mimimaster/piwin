// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_ARTIFACT_DOCUMENT_BYTES } from '@piwin/contracts';
import {
  analyzeArtifactFence,
  createArtifactFenceRecord,
  materializeArtifact,
} from '@piwin/artifact';
import { publishArtifactDocument } from './artifact-document-publication.js';
import {
  advanceArtifactDocumentPhase,
  artifactDocumentKey,
  buildArtifactDocumentDataUrl,
  buildArtifactDocumentUrl,
  resolveArtifactSchemeOrigin,
  createArtifactDocumentId,
  initialArtifactDocumentPhase,
  createArtifactDocumentMediaBinding,
  resolveArtifactDocumentByteLimit,
} from './artifact-document.js';

function decodeDataUrl(url: string): string {
  const separator = url.indexOf(',');
  if (separator < 0) {
    throw new Error('Artifact data URL has no payload');
  }
  const binary = atob(url.slice(separator + 1));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

describe('Artifact document transport', () => {
  it('round-trips Unicode HTML through an opaque data URL', () => {
    const srcdoc = '<!doctype html><title>鹈鹕</title><div>自然撑开</div>';
    const url = buildArtifactDocumentDataUrl(srcdoc);

    expect(url).toMatch(/^data:text\/html;charset=utf-8;base64,/);
    expect(decodeDataUrl(url)).toBe(srcdoc);
  });

  it('mints unguessable ids the Rust store accepts', () => {
    const first = createArtifactDocumentId();
    const second = createArtifactDocumentId();

    expect(first).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(second).not.toBe(first);
  });

  it('keeps browser and e2e documents on data: URLs', () => {
    const srcdoc = '<!doctype html><title>鹈鹕</title>';
    const url = buildArtifactDocumentUrl(createArtifactDocumentId(), srcdoc);

    expect(url).toMatch(/^data:text\/html;charset=utf-8;base64,/);
    expect(decodeDataUrl(url)).toBe(srcdoc);
  });
});

describe('Artifact document transport in Tauri', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('loads packaged frames by id and publishes the document over IPC', async () => {
    const documentId = createArtifactDocumentId();
    // Larger than wry's 65 534-byte scheme URI limit: must not ride in the URL.
    const srcdoc = `<!doctype html><title>鹈鹕</title>${'<p>自然撑开</p>'.repeat(8_000)}`;
    const convertFileSrcCalls: Array<{ filePath: string; protocol: string | undefined }> = [];
    const invokeCalls: Array<{ command: string; args: unknown }> = [];
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        convertFileSrc: (filePath: string, protocol?: string) => {
          convertFileSrcCalls.push({ filePath, protocol });
          return `${protocol}://localhost/${filePath}`;
        },
        invoke: async (command: string, args: unknown) => {
          invokeCalls.push({ command, args });
          return null;
        },
        transformCallback: () => 0,
      },
    });

    const url = buildArtifactDocumentUrl(documentId, srcdoc);
    expect(url).toBe(`piwin-artifact://localhost/${documentId}`);
    expect(convertFileSrcCalls).toEqual([{ filePath: documentId, protocol: 'piwin-artifact' }]);

    await publishArtifactDocument(documentId, srcdoc);
    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0]?.command).toBe('artifact_document_put');
    expect(invokeCalls[0]?.args).toEqual({ id: documentId, html: srcdoc });
  });
  it('resolves the kit origin from the document scheme, and none in a browser build', () => {
    expect(resolveArtifactSchemeOrigin()).toBeNull();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        convertFileSrc: (filePath: string, protocol?: string) =>
          `http://${protocol}.localhost/${filePath}`,
        invoke: async () => null,
        transformCallback: () => 0,
      },
    });
    expect(resolveArtifactSchemeOrigin()).toBe('http://piwin-artifact.localhost');
  });
  it('includes base64/address overhead in browser budgets and keeps the native 2 MiB budget', () => {
    const mediaId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const analysis = analyzeArtifactFence(
      createArtifactFenceRecord({
        info: 'artifact-html',
        source: `<img data-piwin-media="${mediaId}"><a href="http://localhost/">Open</a>`,
      }),
    );
    if (analysis.kind !== 'intent') throw new Error('expected render intent');
    const base = materializeArtifact(analysis.intent, { mode: 'interactive' });
    const binding = createArtifactDocumentMediaBinding(base);
    const prefix = 'data:image/jpeg;base64,';
    const plan = binding.bind(
      new Map([[mediaId, prefix + 'A'.repeat(binding.budget.maxCharacters - prefix.length)]]),
    );
    if (plan.document.kind !== 'sandbox') throw new Error('expected sandbox');
    expect(buildArtifactDocumentDataUrl(plan.document.srcdoc).length).toBeLessThanOrEqual(
      2 * 1024 * 1024,
    );
    const browserLimit = resolveArtifactDocumentByteLimit();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    expect(resolveArtifactDocumentByteLimit()).toBe(MAX_ARTIFACT_DOCUMENT_BYTES);
    expect(browserLimit).toBeLessThan(MAX_ARTIFACT_DOCUMENT_BYTES);
  });
  it('rejects the complete document by UTF-8 byte size before invoking native publication', async () => {
    const invoke = vi.fn(async () => null);
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke },
    });
    const source = '汉'.repeat(Math.ceil(MAX_ARTIFACT_DOCUMENT_BYTES / 3));
    expect(source.length).toBeLessThan(MAX_ARTIFACT_DOCUMENT_BYTES);

    await expect(publishArtifactDocument(createArtifactDocumentId(), source)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('uses the isolated scheme in the iOS shell too, not an inherited-CSP data: frame', () => {
    const userAgent = vi
      .spyOn(window.navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15',
      );
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        convertFileSrc: (filePath: string, protocol?: string) =>
          `${protocol}://localhost/${filePath}`,
      },
    });
    const documentId = createArtifactDocumentId();

    expect(buildArtifactDocumentUrl(documentId, '<!doctype html><p>phone</p>')).toBe(
      `piwin-artifact://localhost/${documentId}`,
    );
    userAgent.mockRestore();
  });
});

describe('artifact document lifecycle', () => {
  it('keeps an empty stream shell until the first stable snapshot, then seeds it', () => {
    expect(initialArtifactDocumentPhase('stream-preview', '')).toBe('empty-stream');
    expect(initialArtifactDocumentPhase('stream-preview', '<div>ready</div>')).toBe(
      'seeded-stream',
    );
    expect(initialArtifactDocumentPhase('interactive', '<div>done</div>')).toBe('final');

    const seeded = advanceArtifactDocumentPhase(
      'empty-stream',
      'stream-preview',
      '<style>.x{}</style><div class="x">ok</div>',
    );
    expect(seeded).toBe('seeded-stream');
    expect(artifactDocumentKey(seeded, 'canvas-1', '<html>seeded</html>')).toBe(
      'stream:canvas-1:seeded',
    );
    expect(advanceArtifactDocumentPhase(seeded, 'stream-preview', '<div>more</div>')).toBe(
      'seeded-stream',
    );
  });

  it('loads the final document on completion instead of freezing the stream shell', () => {
    const completed = advanceArtifactDocumentPhase(
      'seeded-stream',
      'interactive',
      '<div>done</div>',
    );
    expect(completed).toBe('final');
    expect(artifactDocumentKey(completed, 'canvas-1', '<html>final</html>')).toBe(
      'final:canvas-1:<html>final</html>',
    );
  });

  it('starts a new stream document after a completed canvas is updated', () => {
    expect(advanceArtifactDocumentPhase('final', 'stream-preview', '')).toBe('empty-stream');
    expect(advanceArtifactDocumentPhase('final', 'stream-preview', '<div>next</div>')).toBe(
      'seeded-stream',
    );
  });
});
