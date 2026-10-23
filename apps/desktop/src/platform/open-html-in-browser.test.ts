import { describe, expect, it, vi } from 'vitest';
import {
  fileUrlFromAbsolutePath,
  resolveHtmlWorkbenchBrowserUrl,
  shouldOpenHtmlInWorkbenchBrowser,
  tryOpenHtmlDocumentInBrowser,
} from './open-html-in-browser';

describe('shouldOpenHtmlInWorkbenchBrowser', () => {
  it('opens real HTML paths and skips transcript chips', () => {
    expect(shouldOpenHtmlInWorkbenchBrowser('/workspace/out/index.html')).toBe(true);
    expect(shouldOpenHtmlInWorkbenchBrowser('docs/card.html')).toBe(true);
    expect(shouldOpenHtmlInWorkbenchBrowser('file:///Users/me/site/index.htm')).toBe(true);
    expect(shouldOpenHtmlInWorkbenchBrowser('C:\\proj\\index.html')).toBe(true);
    expect(shouldOpenHtmlInWorkbenchBrowser('.html')).toBe(false);
    expect(shouldOpenHtmlInWorkbenchBrowser('card.html')).toBe(false);
    expect(shouldOpenHtmlInWorkbenchBrowser('readme.md')).toBe(false);
  });

  it('treats a project-root HTML name as a real file when asked', () => {
    expect(shouldOpenHtmlInWorkbenchBrowser('index.html', { allowBareFilename: true })).toBe(
      true,
    );
    expect(shouldOpenHtmlInWorkbenchBrowser('.html', { allowBareFilename: true })).toBe(false);
  });
});

describe('fileUrlFromAbsolutePath', () => {
  it('builds a file URL without mangling drive letters or spaces', () => {
    expect(fileUrlFromAbsolutePath('/Users/me/site/index.html')).toBe(
      'file:///Users/me/site/index.html',
    );
    expect(fileUrlFromAbsolutePath('/tmp/My Page.html')).toBe('file:///tmp/My%20Page.html');
    expect(fileUrlFromAbsolutePath('C:\\Users\\me\\a.html')).toBe('file:///C:/Users/me/a.html');
  });
});

describe('resolveHtmlWorkbenchBrowserUrl', () => {
  it('joins a nested relative HTML path onto the project root', () => {
    expect(
      resolveHtmlWorkbenchBrowserUrl({
        path: 'docs/card.html',
        projectPath: '/workspace',
      }),
    ).toBe('file:///workspace/docs/card.html');
  });

  it('does not invent a file URL for a bare chip without a project root', () => {
    expect(resolveHtmlWorkbenchBrowserUrl({ path: 'card.html' })).toBeNull();
    expect(
      resolveHtmlWorkbenchBrowserUrl({
        path: 'card.html',
        projectPath: '/workspace',
      }),
    ).toBeNull();
  });
});

describe('tryOpenHtmlDocumentInBrowser', () => {
  it('navigates the workbench browser for an absolute HTML file', () => {
    const openInspector = vi.fn();
    const navigate = vi.fn();
    const handled = tryOpenHtmlDocumentInBrowser({
      doc: { title: 'index.html', path: '/workspace/out/index.html' },
      projectPath: '/workspace',
      canNavigate: true,
      openInspector,
      navigate,
    });
    expect(handled).toBe(true);
    expect(openInspector).toHaveBeenCalledWith('browser');
    expect(navigate).toHaveBeenCalledWith('file:///workspace/out/index.html');
  });

  it('leaves transcript HTML chips and inline bodies on the document path', () => {
    const openInspector = vi.fn();
    const navigate = vi.fn();
    expect(
      tryOpenHtmlDocumentInBrowser({
        doc: { title: 'HTML', path: 'card.html' },
        projectPath: '/workspace',
        canNavigate: true,
        openInspector,
        navigate,
      }),
    ).toBe(false);
    expect(
      tryOpenHtmlDocumentInBrowser({
        doc: { title: 'Card', path: '/workspace/out/index.html', content: '<h1>Hi</h1>' },
        canNavigate: true,
        openInspector,
        navigate,
      }),
    ).toBe(false);
    expect(openInspector).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens a project-file HTML target even at the workspace root', () => {
    const openInspector = vi.fn();
    const navigate = vi.fn();
    expect(
      tryOpenHtmlDocumentInBrowser({
        doc: {
          title: 'index.html',
          target: {
            kind: 'project-file',
            relativePath: 'index.html',
            displayRef: 'index.html',
          },
        },
        projectPath: '/workspace',
        canNavigate: true,
        openInspector,
        navigate,
      }),
    ).toBe(true);
    expect(navigate).toHaveBeenCalledWith('file:///workspace/index.html');
  });

  it('falls back to Doc Preview when the browser command is unavailable', () => {
    const openInspector = vi.fn();
    const navigate = vi.fn();
    expect(
      tryOpenHtmlDocumentInBrowser({
        doc: { title: 'index.html', path: '/workspace/out/index.html' },
        canNavigate: false,
        openInspector,
        navigate,
      }),
    ).toBe(false);
    expect(openInspector).not.toHaveBeenCalled();
  });
});
