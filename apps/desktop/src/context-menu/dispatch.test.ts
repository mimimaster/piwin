/**
 * Smoke unit for dispatchContextMenuAction (CM §9.6 / CM-04).
 * Verifies actionId → dispatcher call mapping without React.
 */
import { describe, expect, it, vi } from 'vitest';
import { dispatchContextMenuAction, type ContextMenuDispatchers } from './dispatch.js';
import { PRESET_TEMPLATES } from './presets.js';
import type { ContextMenuTarget } from './types.js';

function createDispatchers() {
  return {
    addToChat: vi.fn(),
    focusComposer: vi.fn(),
    sendPreset: vi.fn(),
    openPath: vi.fn(),
    revealPath: vi.fn(),
    copyText: vi.fn(),
    quoteInComposer: vi.fn(),
    retryMessage: vi.fn(),
    truncateAfterMessage: vi.fn(),
    forkMessage: vi.fn(),
    openSideChat: vi.fn(),
    applyToFile: vi.fn(),
    openChangedFiles: vi.fn(),
    notify: vi.fn(),
  } satisfies ContextMenuDispatchers;
}

const fileTarget: ContextMenuTarget = {
  surface: 'file-tree-file',
  projectPath: '/p',
  relativePath: 'src/a.ts',
  absolutePath: '/p/src/a.ts',
  label: 'a.ts',
};

const selectionTarget: ContextMenuTarget = {
  surface: 'selection',
  projectPath: '/p',
  relativePath: 'src/a.ts',
  lineStart: 3,
  lineEnd: 5,
  selectedText: 'const value = 1;',
  label: 'a.ts:3-5',
};

const messageTarget: ContextMenuTarget = {
  surface: 'message-assistant',
  sessionId: 's1',
  messageId: 'm1',
  text: 'the answer',
  label: 'Assistant',
  capabilities: { canRetry: true, canFork: true, canSideChat: true },
};

const codeBlockTarget: ContextMenuTarget = {
  surface: 'code-block',
  relativePath: 'src/b.ts',
  selectedText: 'export const n = 1;',
  label: 'b.ts',
};

describe('dispatchContextMenuAction', () => {
  it('add-to-chat on a transcript selection only adds a capsule', () => {
    const dispatchers = createDispatchers();
    const transcriptSelection: ContextMenuTarget = {
      surface: 'selection',
      selectedText: 'the number 42',
      label: 'the number 42',
    };
    dispatchContextMenuAction('add-to-chat', transcriptSelection, dispatchers);
    expect(dispatchers.addToChat).toHaveBeenCalledWith({
      kind: 'selection',
      snapshotText: 'the number 42',
      label: 'the number 42',
    });
    expect(dispatchers.quoteInComposer).not.toHaveBeenCalled();
    expect(dispatchers.sendPreset).not.toHaveBeenCalled();
  });

  it('add-to-chat maps target to a ref and does not send', () => {
    const dispatchers = createDispatchers();
    dispatchContextMenuAction('add-to-chat', fileTarget, dispatchers);
    expect(dispatchers.addToChat).toHaveBeenCalledTimes(1);
    expect(dispatchers.addToChat.mock.calls[0]?.[0]).toMatchObject({
      kind: 'file',
      projectPath: '/p',
      relativePath: 'src/a.ts',
    });
    expect(dispatchers.sendPreset).not.toHaveBeenCalled();
  });

  it('ask-about adds ref and focuses composer without auto-send', () => {
    const dispatchers = createDispatchers();
    dispatchContextMenuAction('ask-about', selectionTarget, dispatchers);
    expect(dispatchers.addToChat).toHaveBeenCalledTimes(1);
    expect(dispatchers.focusComposer).toHaveBeenCalledTimes(1);
    expect(dispatchers.sendPreset).not.toHaveBeenCalled();
  });

  it('explain auto-sends the preset with the mapped refs', () => {
    const dispatchers = createDispatchers();
    dispatchContextMenuAction('explain', selectionTarget, dispatchers);
    expect(dispatchers.addToChat).toHaveBeenCalledTimes(1);
    expect(dispatchers.sendPreset).toHaveBeenCalledWith(
      PRESET_TEMPLATES.explain,
      [expect.objectContaining({ kind: 'file', lineStart: 3, lineEnd: 5 })],
    );
  });

  it('fix-error sends the error preset with an error ref', () => {
    const dispatchers = createDispatchers();
    dispatchContextMenuAction(
      'fix-error',
      { surface: 'error', title: 'TS2322', detail: 'type mismatch', label: 'err' },
      dispatchers,
    );
    expect(dispatchers.sendPreset).toHaveBeenCalledWith(
      PRESET_TEMPLATES['fix-error'],
      [expect.objectContaining({ kind: 'error', title: 'TS2322' })],
    );
  });

  it('copy copies the surface body; copy-as-ref copies a path#L range', () => {
    const dispatchers = createDispatchers();
    dispatchContextMenuAction('copy', selectionTarget, dispatchers);
    expect(dispatchers.copyText).toHaveBeenCalledWith('const value = 1;');

    const refDispatchers = createDispatchers();
    dispatchContextMenuAction('copy-as-ref', selectionTarget, refDispatchers);
    expect(refDispatchers.copyText).toHaveBeenCalledWith('src/a.ts#L3-5');
  });

  it('copy relative/absolute paths use target path fields', () => {
    const dispatchers = createDispatchers();
    dispatchContextMenuAction('copy-relative-path', fileTarget, dispatchers);
    expect(dispatchers.copyText).toHaveBeenCalledWith('src/a.ts');
    dispatchContextMenuAction('copy-absolute-path', fileTarget, dispatchers);
    expect(dispatchers.copyText).toHaveBeenCalledWith('/p/src/a.ts');
  });

  it('open and reveal dispatch to their callbacks', () => {
    const dispatchers = createDispatchers();
    dispatchContextMenuAction('open', fileTarget, dispatchers);
    expect(dispatchers.openPath).toHaveBeenCalledWith('/p/src/a.ts', 'src/a.ts');
    dispatchContextMenuAction('reveal', fileTarget, dispatchers);
    expect(dispatchers.revealPath).toHaveBeenCalledWith('/p/src/a.ts');
  });

  it('quote-in-composer / retry / fork route message actions', () => {
    const dispatchers = createDispatchers();
    dispatchContextMenuAction('quote-in-composer', messageTarget, dispatchers);
    expect(dispatchers.quoteInComposer).toHaveBeenCalledWith('the answer');
    dispatchContextMenuAction('retry', messageTarget, dispatchers);
    expect(dispatchers.retryMessage).toHaveBeenCalledWith('m1');
    dispatchContextMenuAction('fork', messageTarget, dispatchers);
    expect(dispatchers.forkMessage).toHaveBeenCalledWith('m1');
    dispatchContextMenuAction('truncate-after', messageTarget, dispatchers);
    expect(dispatchers.truncateAfterMessage).toHaveBeenCalledWith('m1');
  });

  it('side-chat carries sourceMessageId only for message surfaces', () => {
    const messageDispatchers = createDispatchers();
    dispatchContextMenuAction('side-chat', messageTarget, messageDispatchers);
    expect(messageDispatchers.openSideChat).toHaveBeenCalledWith({
      sourceMessageId: 'm1',
      refs: [expect.objectContaining({ kind: 'main-message', messageId: 'm1' })],
    });

    const selectionDispatchers = createDispatchers();
    dispatchContextMenuAction('side-chat', selectionTarget, selectionDispatchers);
    expect(selectionDispatchers.openSideChat).toHaveBeenCalledWith({
      refs: [expect.objectContaining({ kind: 'file' })],
    });
  });

  it('apply-to-file passes text and suggested path for code blocks', () => {
    const dispatchers = createDispatchers();
    dispatchContextMenuAction('apply-to-file', codeBlockTarget, dispatchers);
    expect(dispatchers.applyToFile).toHaveBeenCalledWith({
      text: 'export const n = 1;',
      suggestedPath: 'src/b.ts',
    });
  });

  it('rerun-tool announces unavailability instead of dispatching silently', () => {
    const dispatchers = createDispatchers();
    dispatchContextMenuAction(
      'rerun-tool',
      { surface: 'tool-card', toolName: 'bash', outputText: 'x', label: 't', canRerun: true },
      dispatchers,
    );
    expect(dispatchers.notify).toHaveBeenCalledWith(expect.any(String), 'info');
  });

  it('open-changed-files routes to the message dispatcher (CM-15)', () => {
    const dispatchers = createDispatchers();
    dispatchContextMenuAction('open-changed-files', messageTarget, dispatchers);
    expect(dispatchers.openChangedFiles).toHaveBeenCalledWith('m1');
  });

  it('generate-flashcard sends exactly one preset with selection refs and does not write clipboard', () => {
    const dispatchers = createDispatchers();
    dispatchContextMenuAction('generate-flashcard', selectionTarget, dispatchers);

    expect(dispatchers.sendPreset).toHaveBeenCalledTimes(1);
    const [preset, refs] = dispatchers.sendPreset.mock.calls[0] ?? [];
    expect(preset).toBe(PRESET_TEMPLATES['generate-flashcard']);
    expect(String(preset)).toMatch(/flashcard_create|一张|exactly one|single card/i);
    expect(refs).toEqual([
      expect.objectContaining({
        kind: 'file',
        projectPath: '/p',
        relativePath: 'src/a.ts',
        lineStart: 3,
        lineEnd: 5,
      }),
    ]);
    expect(dispatchers.copyText).not.toHaveBeenCalled();
    expect(dispatchers.addToChat).toHaveBeenCalledTimes(1);
  });
});
