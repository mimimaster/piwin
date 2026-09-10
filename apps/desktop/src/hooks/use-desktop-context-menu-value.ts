/**
 * Memoize the app-level context-menu value so deep surfaces do not rebuild
 * dispatchers on every App render.
 */
import { useMemo } from 'react';
import type { DesktopContextMenuValue } from '../context-menu';
import {
  createDesktopContextMenuValue,
  type DesktopContextMenuValueDeps,
} from '../context-menu/desktop-context-menu-value';

export function useDesktopContextMenuValue(
  deps: DesktopContextMenuValueDeps,
): DesktopContextMenuValue {
  const {
    addContextRef,
    addMediaAttachment,
    dispatchNotification,
    handleForkSession,
    handleOpenDocument,
    handleRetryMessage,
    handleSend,
    hostClient,
    hostReady,
    locale,
    openInspector,
    activeSessionId,
    projectPath,
    requestTruncateAfter,
    setComposer,
  } = deps;
  return useMemo(
    () =>
      createDesktopContextMenuValue({
        addContextRef,
        ...(addMediaAttachment ? { addMediaAttachment } : {}),
        dispatchNotification,
        handleForkSession,
        handleOpenDocument,
        handleRetryMessage,
        handleSend,
        hostClient,
        hostReady,
        locale,
        openInspector,
        activeSessionId,
        projectPath,
        requestTruncateAfter,
        setComposer,
      }),
    [
      addContextRef,
      addMediaAttachment,
      dispatchNotification,
      handleForkSession,
      handleOpenDocument,
      handleRetryMessage,
      handleSend,
      hostClient,
      hostReady,
      locale,
      openInspector,
      activeSessionId,
      projectPath,
      requestTruncateAfter,
      setComposer,
    ],
  );
}
