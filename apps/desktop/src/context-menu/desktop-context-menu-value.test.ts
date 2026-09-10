// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetSideChatComposerSeedForTests,
  takeSideChatComposerSeed,
} from '../side-chat-composer-seed.js';
import type { PromptContextRef } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import {
  appendQuotedComposerText,
  buildDesktopContextMenuCaps,
  createDesktopContextMenuValue,
  fileNameFromPath,
  quoteTextForComposer,
  type DesktopContextMenuValueDeps,
} from './desktop-context-menu-value.js';

const fileRef: PromptContextRef = {
  kind: 'file',
  projectPath: '/repo',
  relativePath: 'src/a.ts',
  label: 'a.ts',
};

function fakeHost(commands: string[], sideChatSuccess = true): HostClient {
  return {
    supportsCommand: (command: string) => commands.includes(command),
    sideChatOpen: vi.fn(async () =>
      sideChatSuccess
        ? { success: true as const, data: {} }
        : { success: false as const, error: 'nope' },
    ),
  } as unknown as HostClient;
}

function createDeps(
  overrides: Partial<DesktopContextMenuValueDeps> = {},
): DesktopContextMenuValueDeps {
  return {
    projectPath: '/repo',
    activeSessionId: 'sess-1',
    hostReady: true,
    locale: 'en',
    hostClient: fakeHost(['side-chat/open', 'project/read-file']),
    addContextRef: () => ({
      ok: true,
      item: {
        token: 't',
        key: 'k',
        ref: fileRef,
        label: 'a.ts',
      },
      deduped: false,
    }),
    dispatchNotification: vi.fn(),
    handleOpenDocument: vi.fn(),
    handleRetryMessage: vi.fn(),
    requestTruncateAfter: vi.fn(),
    handleSend: vi.fn(),
    handleForkSession: vi.fn(),
    setComposer: vi.fn(),
    openInspector: vi.fn(),
    ...overrides,
  };
}

describe('quoteTextForComposer', () => {
  it('prefixes every line', () => {
    expect(quoteTextForComposer('a\nb')).toBe('> a\n> b');
  });
});

describe('appendQuotedComposerText', () => {
  it('replaces an empty composer and appends to existing text', () => {
    expect(appendQuotedComposerText('  ', '> a')).toBe('> a');
    expect(appendQuotedComposerText('hello  ', '> a')).toBe('hello\n\n> a');
  });
});

describe('fileNameFromPath', () => {
  it('takes the last path segment', () => {
    expect(fileNameFromPath('src/foo.ts')).toBe('foo.ts');
    expect(fileNameFromPath('')).toBe('File');
  });
});

describe('buildDesktopContextMenuCaps', () => {
  it('requires a live session before advertising side chat', () => {
    expect(
      buildDesktopContextMenuCaps({
        projectPath: '/repo',
        activeSessionId: null,
        hostReady: true,
        locale: 'zh-CN',
        sideChatSupported: true,
        applySupported: true,
        openChangedFilesSupported: true,
      }),
    ).toMatchObject({
      hasProject: true,
      canReveal: true,
      sideChatAvailable: false,
      applyAvailable: true,
      openChangedFilesAvailable: true,
      canSendPreset: false,
      locale: 'zh-CN',
    });
  });

  it('requires a live session and ready host before advertising preset send', () => {
    expect(
      buildDesktopContextMenuCaps({
        projectPath: '/repo',
        activeSessionId: 'sess-1',
        hostReady: true,
        locale: 'en',
        sideChatSupported: true,
        applySupported: true,
        openChangedFilesSupported: true,
      }).canSendPreset,
    ).toBe(true);
    expect(
      buildDesktopContextMenuCaps({
        projectPath: '/repo',
        activeSessionId: 'sess-1',
        hostReady: false,
        locale: 'en',
        sideChatSupported: true,
        applySupported: true,
        openChangedFilesSupported: true,
      }).canSendPreset,
    ).toBe(false);
  });
});

describe('createDesktopContextMenuValue', () => {
  afterEach(() => {
    resetSideChatComposerSeedForTests();
  });

  it('notifies when the context-chip cap is hit', () => {
    const dispatchNotification = vi.fn();
    const value = createDesktopContextMenuValue(
      createDeps({
        addContextRef: () => ({ ok: false, reason: 'cap' }),
        dispatchNotification,
      }),
    );
    value.dispatchers.addToChat(fileRef);
    expect(dispatchNotification).toHaveBeenCalledWith({
      type: 'notify/push',
      notification: {
        level: 'error',
        message: 'Context chip limit reached (12). Remove one first.',
      },
    });
  });

  it('skips fork and side-chat when no session is active', () => {
    const handleForkSession = vi.fn();
    const hostClient = fakeHost(['side-chat/open', 'project/read-file']);
    const value = createDesktopContextMenuValue(
      createDeps({
        activeSessionId: null,
        handleForkSession,
        hostClient,
      }),
    );
    value.dispatchers.forkMessage('msg-1');
    value.dispatchers.openSideChat({ refs: [] });
    expect(handleForkSession).not.toHaveBeenCalled();
    expect(hostClient.sideChatOpen).not.toHaveBeenCalled();
  });

  it('exposes addMediaAttachment when the composer hook is wired', () => {
    const addMediaAttachment = vi.fn();
    const value = createDesktopContextMenuValue(createDeps({ addMediaAttachment }));
    expect(value.caps.canAddMediaAttachment).toBe(true);
    const attachment = {
      id: 'asset-1',
      kind: 'media' as const,
      path: '/Users/me/.piwin/media/s1/a.png',
      mimeType: 'image/png',
      byteSize: 4,
      source: 'generated' as const,
    };
    value.dispatchers.addMediaAttachment?.({
      surface: 'media-image',
      label: 'a.png',
      fileName: 'a.png',
      mimeType: 'image/png',
      attachment,
    });
    expect(addMediaAttachment).toHaveBeenCalledWith(attachment);
  });

  it('quotes into the composer without wiping existing text', () => {
    let next = 'draft';
    const setComposer: DesktopContextMenuValueDeps['setComposer'] = (value) => {
      next = typeof value === 'function' ? value(next) : value;
    };
    const dispatchers = createDesktopContextMenuValue(createDeps({ setComposer })).dispatchers;
    dispatchers.quoteInComposer('hello');
    expect(next).toBe('draft\n\n> hello');
  });

  it('seeds the side-chat composer when opening from a quote', async () => {
    const hostClient = fakeHost(['side-chat/open', 'project/read-file']);
    vi.mocked(hostClient.sideChatOpen).mockResolvedValue({
      type: 'response',
      command: 'side-chat/open',
      success: true,
      data: { sideChatSessionId: 'side-new' },
    });
    const openInspector = vi.fn();
    const value = createDesktopContextMenuValue(createDeps({ hostClient, openInspector }));
    const refs: PromptContextRef[] = [
      { kind: 'selection', snapshotText: 'quoted', label: 'quoted' },
    ];
    value.dispatchers.openSideChat({ refs });
    await vi.waitFor(() => {
      expect(openInspector).toHaveBeenCalledWith('sideChat');
    });
    expect(takeSideChatComposerSeed()).toEqual({
      refs,
      sideChatSessionId: 'side-new',
    });
  });
});
