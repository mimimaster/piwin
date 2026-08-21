/**
 * Slice D: every existing Add-to-Chat surface maps to a shelf ref, not a textarea quote.
 */
import { describe, expect, it, vi } from 'vitest';
import { contextRefFromAtItem } from './at/context-ref-from-at-item.js';
import { dispatchContextMenuAction, type ContextMenuDispatchers } from './context-menu/dispatch.js';
import { mapTargetToContextRef } from './context-menu/map-to-ref.js';
import type { ContextMenuTarget } from './context-menu/types.js';

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
    forkMessage: vi.fn(),
    openSideChat: vi.fn(),
    applyToFile: vi.fn(),
    openChangedFiles: vi.fn(),
    notify: vi.fn(),
  } satisfies ContextMenuDispatchers;
}

const entries: Array<{
  name: string;
  target: ContextMenuTarget;
  kind: string;
}> = [
  {
    name: 'file tree file',
    target: {
      surface: 'file-tree-file',
      projectPath: '/p',
      relativePath: 'src/a.ts',
      absolutePath: '/p/src/a.ts',
      label: 'a.ts',
    },
    kind: 'file',
  },
  {
    name: 'file tree folder',
    target: {
      surface: 'file-tree-folder',
      projectPath: '/p',
      relativePath: 'src',
      absolutePath: '/p/src',
      label: 'src',
    },
    kind: 'folder',
  },
  {
    name: 'whole message',
    target: {
      surface: 'message-assistant',
      sessionId: 's1',
      messageId: 'm1',
      text: 'the answer',
      label: 'Assistant',
      capabilities: { canRetry: false, canFork: false, canSideChat: false },
    },
    kind: 'main-message',
  },
  {
    name: 'code fence',
    target: {
      surface: 'code-block',
      selectedText: 'export const n = 1;',
      label: 'ts',
    },
    kind: 'selection',
  },
  {
    name: 'terminal selection',
    target: {
      surface: 'terminal-selection',
      selectedText: 'error: boom',
      label: 'Terminal selection',
    },
    kind: 'terminal-output',
  },
  {
    name: 'error banner',
    target: {
      surface: 'error',
      title: 'TS2322',
      detail: 'type mismatch',
      label: 'err',
    },
    kind: 'error',
  },
  {
    name: 'tool card',
    target: {
      surface: 'tool-card',
      toolName: 'bash',
      outputText: 'ok',
      label: 'bash',
      canRerun: false,
    },
    kind: 'terminal-output',
  },
];

describe('composer shelf entry points', () => {
  it.each(entries)('$name add-to-chat becomes a $kind capsule', ({ target, kind }) => {
    expect(mapTargetToContextRef(target)).toMatchObject({ kind });
    const dispatchers = createDispatchers();
    dispatchContextMenuAction('add-to-chat', target, dispatchers);
    expect(dispatchers.addToChat).toHaveBeenCalledWith(expect.objectContaining({ kind }));
    expect(dispatchers.quoteInComposer).not.toHaveBeenCalled();
  });

  it('quote-in-composer stays on the whole-message action only', () => {
    const dispatchers = createDispatchers();
    const message = entries.find((entry) => entry.name === 'whole message')?.target;
    if (!message) {
      throw new Error('expected whole message fixture');
    }
    dispatchContextMenuAction('quote-in-composer', message, dispatchers);
    expect(dispatchers.quoteInComposer).toHaveBeenCalledWith('the answer');
  });

  it('maps @ file and folder mentions to the same refs as right-click', () => {
    expect(contextRefFromAtItem({ kind: 'file', name: 'src/a.ts' }, '/p')).toEqual({
      kind: 'file',
      projectPath: '/p',
      relativePath: 'src/a.ts',
      label: 'src/a.ts',
    });
    expect(contextRefFromAtItem({ kind: 'folder', name: 'src' }, '/p')).toMatchObject({
      kind: 'folder',
      relativePath: 'src',
    });
    expect(contextRefFromAtItem({ kind: 'file', name: 'src/a.ts' }, null)).toBeNull();
    expect(contextRefFromAtItem({ kind: 'git', name: 'git:status' }, '/p')).toBeNull();
  });
});
