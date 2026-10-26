/**
 * Binds the screenshot controller to the workbench: the composer's attachment
 * gate, ADR 0082 image refusal for the active session, and its upload queue.
 */
import { useCallback, type Dispatch } from 'react';
import { sessionOperationUnsupportedReason } from '@piwin/contracts';
import { backendCapabilitiesFor } from '../agents/agent-backend-state.js';
import type { ChatUiState } from '../conversation/chat-reducer.js';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import type { NotificationAction } from '../notifications/notification-queue.js';
import { useScreenCapture, type ScreenCaptureController } from './use-screen-capture.js';

export type UseWorkbenchScreenCaptureArgs = {
  state: Pick<ChatUiState, 'backendCapabilitiesBySession' | 'activeSessionId'>;
  locale: DesktopLocale;
  canAttachFiles: () => boolean;
  enqueueAttachmentFile: (file: File, source: 'paste' | 'drop' | 'file-picker') => void;
  dispatchNotification: Dispatch<NotificationAction>;
};

export function useWorkbenchScreenCapture(
  args: UseWorkbenchScreenCaptureArgs,
): ScreenCaptureController {
  const { backendCapabilitiesBySession, activeSessionId } = args.state;
  const { enqueueAttachmentFile } = args;
  const imageRefusal = useCallback(
    (): string | undefined =>
      sessionOperationUnsupportedReason(
        backendCapabilitiesFor(backendCapabilitiesBySession, activeSessionId),
        'images',
      ),
    [activeSessionId, backendCapabilitiesBySession],
  );
  // SC-D06: screenshots reuse the paste source so compression, retry and
  // remote upload behave exactly like a pasted image.
  const attachImage = useCallback(
    (file: File): void => enqueueAttachmentFile(file, 'paste'),
    [enqueueAttachmentFile],
  );
  return useScreenCapture({
    locale: args.locale,
    canAttach: args.canAttachFiles,
    imageRefusal,
    attachImage,
    dispatchNotification: args.dispatchNotification,
  });
}
