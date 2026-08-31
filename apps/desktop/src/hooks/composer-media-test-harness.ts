import { act } from 'react';
import { expect, vi } from 'vitest';
import { createInitialChatUiState, type ChatUiState } from '../chat-reducer';
import type { useComposerMedia } from './use-composer-media';

export type ComposerMediaResult = ReturnType<typeof useComposerMedia>;

export function createInitialTestChatUiState(): ChatUiState {
  return {
    ...createInitialChatUiState(),
    foregroundAdmission: 'ready',
  };
}

export function createPngFile(): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'screenshot.png', {
    type: 'image/png',
  });
}

export function pasteImage(latest: () => ComposerMediaResult): File {
  const image = createPngFile();
  const preventDefault = vi.fn();
  act(() =>
    latest().handleComposerPaste({
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => image }],
      },
      preventDefault,
    } as unknown as Parameters<ComposerMediaResult['handleComposerPaste']>[0]),
  );
  expect(preventDefault).toHaveBeenCalledOnce();
  return image;
}

export function createSavedMediaResponse(commandType: string) {
  if (commandType === 'media/save' || commandType === 'media/save-finish') {
    return {
      type: 'response' as const,
      command: commandType,
      success: true,
      data: {
        asset: {
          id: 'asset-1',
          sessionId: 'session-1',
          absolutePath: '/Users/test/.piwin/media/session-1/screenshot.png',
          mimeType: 'image/png',
          name: 'screenshot.png',
          contentKind: 'image',
          byteSize: 4,
          createdAt: '2026-08-12T00:00:00.000Z',
        },
      },
    };
  }
  if (commandType === 'media/save-begin') {
    return {
      type: 'response' as const,
      command: commandType,
      success: true,
      data: { uploadId: 'upload-1', chunkMaxBytes: 384 * 1024 },
    };
  }
  if (commandType === 'media/save-chunk') {
    return {
      type: 'response' as const,
      command: commandType,
      success: true,
      data: { uploadId: 'upload-1', receivedBytes: 4 },
    };
  }
  if (commandType === 'media/save-abort') {
    return {
      type: 'response' as const,
      command: commandType,
      success: true,
      data: { uploadId: 'upload-1' },
    };
  }
  if (commandType === 'session/prompt') {
    return {
      type: 'response' as const,
      command: commandType,
      success: true,
      data: { runId: 'run-1', acceptedAt: '2026-08-12T00:00:00.000Z' },
    };
  }
  return { type: 'response' as const, command: commandType, success: true, data: {} };
}
