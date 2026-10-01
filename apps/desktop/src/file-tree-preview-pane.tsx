import type { ReactElement } from 'react';
import { FileTypeIcon, IconButton, Spinner } from '@piwin/ui-kit';
import { IconClose } from './shell-icons';
import { CodePreviewView } from './code-preview-view';
import { PreviewUnavailable } from './PreviewUnavailable';
import { FILE_TREE_IMAGE_PREVIEW_MAX_BYTES } from './preview-unavailable';
import { EnhancedMarkdownView } from './EnhancedMarkdownView';
import type { DesktopLocale } from './desktop-locale';
import type { ContextMenuDispatchers } from './context-menu';
import { MarkupPreviewView } from './markup-preview-view';
import { previewErrorReason, type FilePreviewState } from './file-tree-preview-state.js';

export type FileTreePreviewPaneProps = {
  locale: DesktopLocale;
  preview: FilePreviewState | null;
  previewLoading: boolean;
  previewError: string | null;
  previewFileName: string;
  selectedPath: string | null;
  projectPath: string;
  closeFilePreview: () => void;
  contextMenuCaps: {
    hasProject: boolean;
    canReveal: boolean;
    revealDisabledHint?: string;
    sideChatAvailable: boolean;
    applyAvailable: boolean;
    canSendPreset: boolean;
    locale: DesktopLocale;
  };
  contextMenuDispatchers: ContextMenuDispatchers;
  markupKind: 'html' | 'svg' | null;
  showMarkupPreview: boolean;
  showImagePreview: boolean;
  showMarkdownPreview: boolean;
  binaryUnavailableReason: string | null;
};

export function FileTreePreviewPane(props: FileTreePreviewPaneProps): ReactElement {
  const {
    locale,
    preview,
    previewLoading,
    previewError,
    previewFileName,
    selectedPath,
    projectPath,
    closeFilePreview,
    contextMenuCaps,
    contextMenuDispatchers,
    markupKind,
    showMarkupPreview,
    showImagePreview,
    showMarkdownPreview,
    binaryUnavailableReason,
  } = props;
  return (
        <section
          className="file-tree-preview"
          data-testid="file-tree-preview"
          aria-label="File preview"
        >
          <header className="file-tree-preview-header">
            <div className="file-tree-preview-title">
              {previewFileName ? (
                <>
                  <FileTypeIcon filePathOrExt={previewFileName} />
                  <strong title={preview?.relativePath ?? selectedPath ?? undefined}>
                    {previewFileName}
                  </strong>
                </>
              ) : (
                <strong>{locale === 'zh-CN' ? '文件预览' : 'File preview'}</strong>
              )}
            </div>
            <IconButton
              title={locale === 'zh-CN' ? '关闭预览' : 'Close preview'}
              label={locale === 'zh-CN' ? '关闭预览' : 'Close preview'}
              data-testid="file-tree-preview-close"
              onClick={closeFilePreview}
            >
              <IconClose width={14} height={14} />
            </IconButton>
          </header>
          <div className="file-tree-preview-body">
            {previewLoading && !preview ? (
              <div className="file-tree-loading">
                <Spinner />
                <span className="muted">{locale === 'zh-CN' ? '加载中…' : 'Loading…'}</span>
              </div>
            ) : null}
            {previewError ? (
              <PreviewUnavailable
                reason={previewErrorReason(previewError)}
                locale={locale}
                fileName={previewFileName}
                testId="file-tree-preview-unavailable"
              />
            ) : null}
            {preview && showImagePreview && preview.previewDataUrl ? (
              <div className="file-tree-preview-image-stage" data-testid="file-tree-preview-image">
                <img
                  className="file-tree-preview-image"
                  src={preview.previewDataUrl}
                  alt={previewFileName || preview.relativePath}
                  draggable={false}
                />
                {preview.previewQuality ? (
                  <span
                    className="file-tree-preview-image-badge"
                    data-testid="file-tree-preview-image-badge"
                    role="status"
                  >
                    {preview.previewQuality === 'placeholder'
                      ? locale === 'zh-CN'
                        ? '正在加载原图…'
                        : 'Loading full resolution…'
                      : locale === 'zh-CN'
                        ? '原图加载失败，当前为预览图'
                        : 'Full resolution unavailable; showing a preview'}
                  </span>
                ) : null}
              </div>
            ) : null}
            {preview && binaryUnavailableReason ? (
              <PreviewUnavailable
                reason={binaryUnavailableReason}
                locale={locale}
                fileName={previewFileName || preview.relativePath}
                {...(preview.byteSize !== undefined ? { byteSize: preview.byteSize } : {})}
                {...(binaryUnavailableReason === 'too-large'
                  ? { maxBytes: FILE_TREE_IMAGE_PREVIEW_MAX_BYTES }
                  : {})}
                testId="file-tree-preview-binary"
              />
            ) : null}
            {preview && !preview.isBinary && !showImagePreview ? (
              <>
                {preview.truncated ? (
                  <div className="file-tree-preview-truncated muted">
                    {locale === 'zh-CN' ? '内容已截断' : 'Content truncated'}
                  </div>
                ) : null}
                {showMarkupPreview && markupKind ? (
                  <MarkupPreviewView
                    source={preview.content}
                    kind={markupKind}
                    locale={locale}
                  />
                ) : showMarkdownPreview ? (
                  <EnhancedMarkdownView
                    text={preview.content}
                    docTitle={previewFileName || preview.relativePath}
                    filePath={preview.relativePath}
                    {...(projectPath ? { projectPath: projectPath } : {})}
                  />
                ) : (
                  <CodePreviewView
                    code={preview.content}
                    filePath={preview.relativePath}
                    projectPath={projectPath ?? undefined}
                    contextMenuCaps={contextMenuCaps}
                    contextMenuDispatchers={contextMenuDispatchers}
                  />
                )}
              </>
            ) : null}
          </div>
        </section>
  );
}
