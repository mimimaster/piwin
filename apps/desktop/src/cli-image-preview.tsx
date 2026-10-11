import { useCallback, useRef, useState, type ReactElement } from 'react';
import type { MediaAttachmentRef } from '@piwin/contracts';
import { Modal, Spinner } from '@piwin/ui-kit';
import type { DesktopLocale } from './desktop-locale.js';
import type { HostClient } from './host-client.js';
import { MediaPreview } from './MediaPreview';
import { lookupCliImage } from './cli-image-lookup.js';

type PreviewState =
  | { kind: 'loading'; fileName: string }
  | { kind: 'ready'; fileName: string; sessionId: string; attachment: MediaAttachmentRef }
  | { kind: 'unavailable'; fileName: string; reason: string };

/** Shows an image the agent's own TUI generated, in Desktop instead of on the Host machine. */
export function useCliImagePreview(input: {
  hostClient: HostClient;
  sessionId: string | null;
  locale: DesktopLocale;
}): { open: (fileName: string) => void; element: ReactElement | null } {
  const [state, setState] = useState<PreviewState | null>(null);
  const request = useRef(0);
  const chinese = input.locale === 'zh-CN';
  const { hostClient, sessionId } = input;
  const open = useCallback((fileName: string): void => {
    if (sessionId === null) return;
    const ticket = ++request.current;
    setState({ kind: 'loading', fileName });
    void lookupCliImage(hostClient, sessionId, fileName).then((result) => {
      // A newer click or a closed dialog owns the state.
      if (request.current !== ticket) return;
      if (result.status === 'found') {
        setState({ kind: 'ready', fileName, sessionId, attachment: result.attachment });
      } else {
        setState({
          kind: 'unavailable', fileName,
          reason: result.status === 'failed'
            ? result.error
            : chinese ? '这张图片还没有同步到会话里。' : 'This image has not reached the conversation yet.',
        });
      }
    });
  }, [chinese, hostClient, sessionId]);
  const close = (): void => { request.current += 1; setState(null); };
  return {
    open,
    element: state === null ? null : (
      <Modal open onOpenChange={(next) => { if (!next) close(); }} title={state.fileName} size="lg"
        className="cli-image-preview" testId="cli-image-preview">
        {state.kind === 'loading' ? (
          <div className="cli-image-preview-status"><Spinner label={chinese ? '正在获取图片…' : 'Fetching image…'} /></div>
        ) : state.kind === 'ready' ? (
          <MediaPreview attachment={state.attachment} sessionId={state.sessionId} hero role="assistant" locale={input.locale} />
        ) : (
          <div className="cli-image-preview-status" role="alert">{state.reason}</div>
        )}
      </Modal>
    ),
  };
}
