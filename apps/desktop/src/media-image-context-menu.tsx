/**
 * Shared media-image context menu for chat previews, lightboxes, and library tiles.
 */
import { useMemo, type ReactElement, type ReactNode } from 'react';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuCapabilities,
  type ContextMenuDispatchers,
  type MediaImageTarget,
} from './context-menu';
import { useDesktopLocale } from './desktop-locale-context';
import { useLocalFileActions } from './local-file-actions-context';
import {
  canRevealInLocalFileManager,
  revealDisabledHint,
} from './local-file-reveal-policy';
import { copyMediaImage, saveMediaImageAs } from './media-image-actions';
import { mediaDownloadFileName } from './media-image-target';
import { saveAsResultNotice } from './local-file-actions';
import { looksLikeFilesystemWorkspacePath } from './workspace-open';

export type MediaImageContextMenuProps = {
  target: MediaImageTarget;
  children: ReactNode;
  onOpen?: () => void;
  loadOriginalUrl?: () => Promise<string | null>;
  onAfterAddToChat?: () => void;
  testId?: string;
};

function notifySaveResult(
  result: Awaited<ReturnType<typeof saveMediaImageAs>>,
  locale: 'zh-CN' | 'en',
  notify: ContextMenuDispatchers['notify'],
): void {
  const notice = saveAsResultNotice(result, locale);
  if (notice) {
    notify(notice.message, notice.level);
  }
}

export function MediaImageContextMenu(props: MediaImageContextMenuProps): ReactElement {
  const desktop = useDesktopContextMenu();
  const localFiles = useLocalFileActions();
  const { locale } = useDesktopLocale();
  const { target, loadOriginalUrl, onOpen, onAfterAddToChat } = props;
  const canReveal = Boolean(
    target.absolutePath && canRevealInLocalFileManager(target.absolutePath),
  );
  const canSaveAs = Boolean(
    (target.absolutePath && looksLikeFilesystemWorkspacePath(target.absolutePath)) ||
      target.srcUrl ||
      loadOriginalUrl,
  );

  const caps: ContextMenuCapabilities = useMemo(() => {
    const base: ContextMenuCapabilities = desktop?.caps ?? {
      hasProject: false,
      canReveal: false,
      sideChatAvailable: false,
      applyAvailable: false,
      canSendPreset: false,
      locale,
    };
    return {
      ...base,
      canReveal,
      canSaveAs,
      ...(canReveal ? {} : { revealDisabledHint: revealDisabledHint(locale) }),
    };
  }, [canReveal, canSaveAs, desktop?.caps, locale]);

  const dispatchers: ContextMenuDispatchers = useMemo(() => {
    const notify = desktop?.dispatchers.notify ?? (() => undefined);
    const bytesSource = {
      fileName: mediaDownloadFileName(target.fileName, target.mimeType),
      ...(target.absolutePath ? { absolutePath: target.absolutePath } : {}),
      ...(target.srcUrl ? { srcUrl: target.srcUrl } : {}),
      ...(loadOriginalUrl ? { loadOriginalUrl } : {}),
      ...(localFiles?.saveAs ? { saveLocalPath: localFiles.saveAs } : {}),
    };
    const local: ContextMenuDispatchers = {
      addToChat: desktop?.dispatchers.addToChat ?? (() => undefined),
      focusComposer: desktop?.dispatchers.focusComposer ?? (() => undefined),
      sendPreset: desktop?.dispatchers.sendPreset ?? (() => undefined),
      openPath: desktop?.dispatchers.openPath ?? (() => undefined),
      revealPath: desktop?.dispatchers.revealPath ?? (() => undefined),
      copyText: desktop?.dispatchers.copyText ?? (() => undefined),
      quoteInComposer: desktop?.dispatchers.quoteInComposer ?? (() => undefined),
      retryMessage: desktop?.dispatchers.retryMessage ?? (() => undefined),
      forkMessage: desktop?.dispatchers.forkMessage ?? (() => undefined),
      openSideChat: desktop?.dispatchers.openSideChat ?? (() => undefined),
      notify,
      saveMediaAs: (mediaTarget) => {
        void saveMediaImageAs({
          ...bytesSource,
          fileName: mediaDownloadFileName(mediaTarget.fileName, mediaTarget.mimeType),
        }).then((result) => {
          notifySaveResult(result, locale, notify);
        });
      },
      copyImage: (mediaTarget) => {
        void copyMediaImage({
          ...bytesSource,
          fileName: mediaDownloadFileName(mediaTarget.fileName, mediaTarget.mimeType),
        }).then((ok) => {
          if (ok) {
            notify(locale === 'zh-CN' ? '已复制图片' : 'Image copied', 'success');
            return;
          }
          notify(locale === 'zh-CN' ? '复制图片失败' : 'Could not copy image', 'error');
        });
      },
      openMedia: () => {
        onOpen?.();
      },
      addMediaAttachment: (mediaTarget) => {
        desktop?.dispatchers.addMediaAttachment?.(mediaTarget);
        onAfterAddToChat?.();
      },
    };
    return {
      ...desktop?.dispatchers,
      ...local,
    };
  }, [desktop?.dispatchers, loadOriginalUrl, localFiles, locale, onAfterAddToChat, onOpen, target]);

  return (
    <ContextMenuFromCatalog
      target={target}
      caps={caps}
      dispatchers={dispatchers}
      testId={props.testId ?? 'media-image-context-menu'}
    >
      {props.children}
    </ContextMenuFromCatalog>
  );
}
