// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { RendererActivity } from '../platform/renderer-self-heal.js';
import {
  readWorkbenchRendererActivity,
  useWorkbenchRendererSelfHeal,
} from './use-workbench-renderer-self-heal.js';

const { install, dispose } = vi.hoisted(() => ({
  install: vi.fn<(read: () => RendererActivity) => () => void>(),
  dispose: vi.fn(),
}));
vi.mock('../platform/renderer-self-heal.js', () => ({ installRendererSelfHeal: install }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Input = Parameters<typeof readWorkbenchRendererActivity>[0];
function fixture(): Input {
  return {
    state: { hostReady: true, streaming: false, compacting: false },
    chrome: {
      settingsOpen: false,
      activeSubPage: null,
      knowledgeOpen: false,
      editingMessageId: null,
      showOverlayScrim: false,
    },
    model: {
      composer: '',
      pendingAttachments: [],
      pendingContextRefs: [],
      screenCapture: { phase: { kind: 'idle' } },
      live: { starting: false, call: null },
      extensionUiRequest: null,
      backendUserInput: null,
    },
  };
}

describe('workbench renderer protection', () => {
  it('keeps a Host turn separate from irreplaceable local work', () => {
    const input = fixture();
    input.state.streaming = true;
    expect(readWorkbenchRendererActivity(input)).toEqual({ runActive: true, protectedWork: false });
    input.state.streaming = false;
    input.state.compacting = true;
    expect(readWorkbenchRendererActivity(input)).toEqual({ runActive: true, protectedWork: false });
  });

  const protectors: [string, (input: Input) => void][] = [
    [
      'unsent text',
      (input) => {
        input.model.composer = 'keep this';
      },
    ],
    [
      'pending media',
      (input) => {
        input.model.pendingAttachments = [
          {
            localId: 'file',
            previewUrl: '',
            attachment: {
              kind: 'media',
              id: 'pending',
              path: '',
              mimeType: 'image/png',
              byteSize: 8,
              source: 'paste',
            },
          },
        ];
      },
    ],
    [
      'context chips',
      (input) => {
        input.model.pendingContextRefs = [
          {
            token: 'chip-1',
            key: 'file-1',
            label: 'File',
            ref: { kind: 'file', projectPath: '/project', relativePath: 'file.ts', label: 'File' },
          },
        ];
      },
    ],
    [
      'settings forms',
      (input) => {
        input.chrome.settingsOpen = true;
      },
    ],
    [
      'workspace editors',
      (input) => {
        input.chrome.activeSubPage = 'knowledge';
      },
    ],
    [
      'knowledge dialog',
      (input) => {
        input.chrome.knowledgeOpen = true;
      },
    ],
    [
      'message editor',
      (input) => {
        input.chrome.editingMessageId = 'message';
      },
    ],
    [
      'overlay forms',
      (input) => {
        input.chrome.showOverlayScrim = true;
      },
    ],
    [
      'screenshots',
      (input) => {
        input.model.screenCapture.phase = { kind: 'running' };
      },
    ],
    [
      'live media startup',
      (input) => {
        input.model.live.starting = true;
      },
    ],
    [
      'Host reconnection',
      (input) => {
        input.state.hostReady = false;
      },
    ],
  ];
  it.each(protectors)('defers reclamation for %s', (_name, protect) => {
    const input = fixture();
    expect(readWorkbenchRendererActivity(input).protectedWork).toBe(false);
    protect(input);
    expect(readWorkbenchRendererActivity(input).protectedWork).toBe(true);
  });

  it('updates protection without reinstalling the reclaim controller on every token', () => {
    install.mockReset().mockReturnValue(dispose);
    dispose.mockReset();
    const root = createRoot(document.createElement('div'));
    function Harness({ input }: { input: Input }) {
      useWorkbenchRendererSelfHeal(input);
      return null;
    }
    try {
      const input = fixture();
      act(() => root.render(<Harness input={input} />));
      const read = install.mock.calls[0]?.[0];
      if (!read) throw new Error('reclaim controller was not installed');
      expect(read().protectedWork).toBe(false);
      const editing = fixture();
      editing.model.composer = 'still typing';
      act(() => root.render(<Harness input={editing} />));
      expect(read().protectedWork).toBe(true);
      expect(install).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
    }
    expect(dispose).toHaveBeenCalledOnce();
  });
});
