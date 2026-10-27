import { describe, expect, it } from 'vitest';
import { buildPlainTextCopyRuntime } from './srcdoc-copy.js';

type CopyEvent = {
  defaultPrevented: boolean;
  target: unknown;
  clipboardData: { setData: (type: string, value: string) => void } | null;
  preventDefault: () => void;
};

function runRuntime(selectionText: string) {
  const listeners: Array<(event: CopyEvent) => void> = [];
  const fakeDocument = {
    addEventListener: (type: string, listener: (event: CopyEvent) => void) => {
      if (type === 'copy') listeners.push(listener);
    },
  };
  const fakeWindow = {
    getSelection: () => ({
      isCollapsed: selectionText.length === 0,
      toString: () => selectionText,
    }),
  };
  new Function('document', 'window', buildPlainTextCopyRuntime())(fakeDocument, fakeWindow);

  const copy = (options: { prevented?: boolean; target?: unknown } = {}) => {
    const written = new Map<string, string>();
    const event: CopyEvent = {
      defaultPrevented: options.prevented ?? false,
      target: options.target ?? { nodeType: 3, parentElement: { closest: () => null } },
      clipboardData: { setData: (type, value) => written.set(type, value) },
      preventDefault: () => {
        event.defaultPrevented = true;
      },
    };
    for (const listener of listeners) listener(event);
    return { written, prevented: event.defaultPrevented };
  };
  return { copy };
}

describe('Artifact plain-text copy runtime', () => {
  it('writes only the selected text, with no HTML twin', () => {
    const { written, prevented } = runRuntime('Encrypted content').copy();
    expect([...written.entries()]).toEqual([['text/plain', 'Encrypted content']]);
    expect(prevented).toBe(true);
  });

  it('leaves a copy the Artifact already handled alone', () => {
    const { written } = runRuntime('words').copy({ prevented: true });
    expect(written.size).toBe(0);
  });

  it('leaves copies out of form fields to the browser', () => {
    const field = { nodeType: 1, closest: (selector: string) => (selector.includes('textarea') ? {} : null) };
    const { written, prevented } = runRuntime('typed').copy({ target: field });
    expect(written.size).toBe(0);
    expect(prevented).toBe(false);
  });

  it('does nothing without a selection', () => {
    const { written, prevented } = runRuntime('').copy();
    expect(written.size).toBe(0);
    expect(prevented).toBe(false);
  });
});
