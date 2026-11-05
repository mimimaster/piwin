// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showUiNotification } from '@piwin/ui-kit';
import { saveArtifactDownload } from '../artifact/artifact-download.js';
import { createInitialChatUiState } from '../conversation/chat-reducer.js';
import type { HostClient } from '../host/host-client.js';
import { useWorkbenchArtifactActions } from './use-workbench-artifact-actions.js';

vi.mock('@piwin/ui-kit', () => ({ showUiNotification: vi.fn() }));
vi.mock('../artifact/artifact-download.js', () => ({ saveArtifactDownload: vi.fn() }));

describe('workbench artifact downloads', () => {
  let root: Root;
  let container: HTMLDivElement;
  let actions: ReturnType<typeof useWorkbenchArtifactActions> | undefined;
  const dispatchNotification = vi.fn();
  const download = {
    type: 'piwin-artifact:action',
    channelId: 'cat',
    action: 'artifact/download',
    payload: { filename: 'cat.png', dataUrl: 'data:image/png;base64,AQID' },
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    function Harness() {
      actions = useWorkbenchArtifactActions({
        hostClient: { request: vi.fn() } as unknown as HostClient,
        state: createInitialChatUiState(),
        dispatch: vi.fn(),
        dispatchNotification,
      });
      return null;
    }
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('saves once and shows one notice without duplicating it into the legacy queue', async () => {
    vi.mocked(saveArtifactDownload).mockResolvedValue({ kind: 'saved' });
    await act(async () => {
      actions?.handleArtifactAction(download);
    });
    expect(saveArtifactDownload).toHaveBeenCalledWith(download.payload);
    expect(showUiNotification).toHaveBeenCalledExactlyOnceWith({
      message: '已保存',
      tone: 'success',
    });
    expect(dispatchNotification).not.toHaveBeenCalled();
  });

  it('keeps cancellation silent and allows the next download', async () => {
    vi.mocked(saveArtifactDownload).mockResolvedValue({ kind: 'cancelled' });
    await act(async () => {
      actions?.handleArtifactAction(download);
    });
    expect(showUiNotification).not.toHaveBeenCalled();
    await act(async () => {
      actions?.handleArtifactAction(download);
    });
    expect(saveArtifactDownload).toHaveBeenCalledTimes(2);
  });

  it('does not open overlapping Save As dialogs', async () => {
    let finish: ((result: { kind: 'saved' }) => void) | undefined;
    vi.mocked(saveArtifactDownload).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    act(() => {
      actions?.handleArtifactAction(download);
      actions?.handleArtifactAction(download);
    });
    expect(saveArtifactDownload).toHaveBeenCalledOnce();
    await act(async () => {
      finish?.({ kind: 'saved' });
    });
  });

  it('shows a single readable failure without sending the user back to the agent', () => {
    actions?.handleArtifactAction({
      type: 'piwin-artifact:action',
      channelId: 'cat',
      action: 'artifact/download-unsupported',
      payload: { filename: 'cat.png', reason: 'read-failed' },
    });
    expect(showUiNotification).toHaveBeenCalledExactlyOnceWith({
      message: '无法读取「cat.png」的内容，请重试。',
      tone: 'warning',
    });
    expect(dispatchNotification).not.toHaveBeenCalled();
  });
});
