import type { ReactElement } from 'react';
import type { HostCommand, HostResponse, MediaLibraryItem } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale';
import { IconCheck, IconTrash } from '../../shell-icons';
import { LibraryInspectorDrawer } from './library-inspector-drawer';
import { LibraryLightbox } from './library-lightbox';
import type { ToastState } from './media-library-workspace-model';

export type MediaLibraryWorkspaceOverlaysProps = {
  translate: (english: string, chinese: string) => string;
  selectedIds: ReadonlySet<string>;
  inspectorOpen: boolean;
  activeInspectorItem: MediaLibraryItem | null;
  onCloseInspector: () => void;
  locale?: DesktopLocale | undefined;
  request: (command: HostCommand) => Promise<HostResponse>;
  resolveSrc: (localPath: string, fallbackUrl: string) => string;
  onOpenInspectorLightbox: () => void;
  onDeleteInspectorItem: () => void;
  onCopyInspectorPrompt: (text: string) => void;
  inspectorCopied: boolean;
  onRemixInspectorItem: () => void;
  lightboxItem: MediaLibraryItem | null;
  lightboxCopied: boolean;
  onCloseLightbox: () => void;
  onCopyLightboxPrompt: () => void;
  onDeleteLightboxItem: () => void;
  onRemixLightboxItem: () => void;
  onAfterAddToChat: () => void;
  onPrevLightbox?: (() => void) | undefined;
  onNextLightbox?: (() => void) | undefined;
  currentLightboxIndex: number;
  totalLightboxCount: number;
  batchDeleteOpen: boolean;
  onCloseBatchDelete: () => void;
  onDeleteBatch: () => void;
  toast: ToastState | null;
};

export function MediaLibraryWorkspaceOverlays(
  props: MediaLibraryWorkspaceOverlaysProps,
): ReactElement {
  const t = props.translate;

  return (
    <>
      <LibraryInspectorDrawer
        item={props.activeInspectorItem}
        isOpen={props.inspectorOpen && props.activeInspectorItem !== null}
        onClose={props.onCloseInspector}
        locale={props.locale}
        request={props.request}
        resolveSrc={props.resolveSrc}
        onOpenLightbox={props.onOpenInspectorLightbox}
        onDelete={props.onDeleteInspectorItem}
        onCopyPrompt={props.onCopyInspectorPrompt}
        copied={props.inspectorCopied}
        onRemix={() => props.onRemixInspectorItem()}
      />

      {props.lightboxItem !== null ? (
        <LibraryLightbox
          item={props.lightboxItem}
          request={props.request}
          {...(props.locale !== undefined ? { locale: props.locale } : {})}
          resolveSrc={props.resolveSrc}
          copied={props.lightboxCopied}
          onClose={props.onCloseLightbox}
          onCopyPrompt={props.onCopyLightboxPrompt}
          onDelete={props.onDeleteLightboxItem}
          onRemix={props.onRemixLightboxItem}
          onAfterAddToChat={props.onAfterAddToChat}
          {...(props.onPrevLightbox !== undefined ? { onPrev: props.onPrevLightbox } : {})}
          {...(props.onNextLightbox !== undefined ? { onNext: props.onNextLightbox } : {})}
          currentIndex={props.currentLightboxIndex}
          totalCount={props.totalLightboxCount}
        />
      ) : null}

      {props.batchDeleteOpen ? (
        <div
          className="lib-confirm-back"
          onClick={props.onCloseBatchDelete}
          data-testid="library-batch-delete-confirm"
        >
          <div
            className="lib-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="lib-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="lib-confirm-title" id="lib-confirm-title">
              {t(
                `Delete ${props.selectedIds.size} assets?`,
                `确定删除这 ${props.selectedIds.size} 项素材？`,
              )}
            </h2>
            <p className="lib-confirm-detail">
              {t(
                'The files are removed from your local vault. This cannot be undone.',
                '这些文件会从本地资料库中移除，且无法撤销。',
              )}
            </p>
            <div className="lib-confirm-actions">
              <button
                type="button"
                className="lib-batch-act-btn is-quiet"
                onClick={props.onCloseBatchDelete}
              >
                {t('Cancel', '取消')}
              </button>
              <button
                type="button"
                className="lib-batch-act-btn is-danger"
                data-testid="library-batch-delete-confirm-btn"
                onClick={props.onDeleteBatch}
              >
                <IconTrash width={13} height={13} aria-hidden="true" />
                <span>{t('Delete', '删除')}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {props.toast ? (
        <div
          className={`lib-toast-pill${props.selectedIds.size > 0 ? ' is-lifted' : ''}`}
          role="status"
          aria-live="polite"
        >
          <IconCheck width={14} height={14} aria-hidden="true" />
          <span>{props.toast.message}</span>
          {props.toast.actionLabel && props.toast.onAction ? (
            <button
              type="button"
              className="lib-toast-action"
              data-testid="library-toast-action"
              onClick={props.toast.onAction}
            >
              {props.toast.actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
