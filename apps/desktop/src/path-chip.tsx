import { useMemo, type ReactElement } from 'react';
import type { PromptContextRef } from '@piwin/contracts';
import { FileTypeIcon } from '@piwin/ui-kit';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuDispatchers,
} from './context-menu';
import type { DesktopLocale } from './desktop-locale';
import { useDesktopLocale } from './desktop-locale-context';
import {
  revealLocalFileInFolder,
  resolveLocalFileAbsolutePath,
  saveLocalFileAs,
} from './local-file-actions.js';
import { useLocalFileActions } from './local-file-actions-context.js';

export type PathChipProps = {
  fullPath: string;
  onOpen: () => void;
  label?: string | undefined;
  className?: string | undefined;
  showIcon?: boolean | undefined;
  'data-testid'?: string | undefined;
  /** Optional project root — enables Add to Chat / relative path / resolve. */
  projectPath?: string | undefined;
  /** Optional path relative to project root. */
  relativePath?: string | undefined;
  onAddContextRef?: ((ref: PromptContextRef) => void) | undefined;
  /** Optional toast/notify hook for action results. */
  onNotify?: ((message: string, level: 'success' | 'error' | 'info') => void) | undefined;
};

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function relativePathFromFull(fullPath: string, projectPath: string | undefined): string {
  if (!projectPath) {
    return fullPath;
  }
  const normalizedRoot = projectPath.replace(/\/+$/, '');
  if (fullPath === normalizedRoot) {
    return '';
  }
  if (fullPath.startsWith(`${normalizedRoot}/`)) {
    return fullPath.slice(normalizedRoot.length + 1);
  }
  return fullPath;
}

/**
 * Renders a file path as a compact chip with distinct file-type icons & colors.
 * Left click opens the file; right click offers CM path-chip actions when wired.
 */
export function PathChip({
  fullPath,
  onOpen,
  label,
  className = 'md-doc-chip',
  showIcon = true,
  'data-testid': testId,
  projectPath,
  relativePath,
  onAddContextRef,
  onNotify,
}: PathChipProps): ReactElement {
  const { locale } = useDesktopLocale();
  const localFileActions = useLocalFileActions();
  const desktopMenu = useDesktopContextMenu();
  const displayText = label ?? fileNameFromPath(fullPath);
  const absolutePath = resolveLocalFileAbsolutePath(fullPath, projectPath);
  const resolvedRelative =
    relativePath ??
    (projectPath ? relativePathFromFull(absolutePath, projectPath) : fullPath);
  const addContextRef = onAddContextRef ?? desktopMenu?.dispatchers.addToChat;
  const notify = onNotify ?? desktopMenu?.dispatchers.notify;
  const hasProjectContext = Boolean(projectPath && addContextRef);
  // Absolute host paths (or project-resolved) can reveal / save-as.
  const canActOnDisk =
    absolutePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(absolutePath);

  const dispatchers: ContextMenuDispatchers = useMemo(
    () => ({
      addToChat: (ref) => {
        addContextRef?.(ref);
      },
      focusComposer: () => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="composer-input"]',
        );
        textarea?.focus();
      },
      sendPreset: () => undefined,
      openPath: () => {
        onOpen();
      },
      revealPath: (path) => {
        void revealLocalFileInFolder(path).then((result) => {
          if (result.ok) {
            return;
          }
          if (result.reason === 'not-desktop') {
            notify?.(
              locale === 'zh-CN'
                ? '当前是浏览器预览，无法打开 Finder。请用桌面窗口。'
                : 'Show in Finder needs the desktop window, not the browser preview.',
              'error',
            );
            return;
          }
          notify?.(
            locale === 'zh-CN' ? '无法在文件管理器中打开' : 'Could not show in file manager',
            'error',
          );
        });
      },
      savePathAs: (path) => {
        const save = localFileActions?.saveAs ?? ((target) => saveLocalFileAs(target));
        void save(path)
          .then((result) => {
            if (result.kind === 'downloaded') {
              notify?.(locale === 'zh-CN' ? '已开始另存为' : 'Save As started', 'success');
              return;
            }
            if (result.kind === 'revealed-fallback') {
              notify?.(
                locale === 'zh-CN'
                  ? '已复制完整路径并打开所在文件夹，请手动拷贝文件'
                  : 'Path copied and folder opened — copy the file manually',
                'info',
              );
              return;
            }
            if (result.kind === 'failed') {
              notify?.(
                locale === 'zh-CN' ? '另存为失败' : 'Save As failed',
                'error',
              );
            }
          })
          .catch(() => {
            notify?.(
              locale === 'zh-CN' ? '另存为失败' : 'Save As failed',
              'error',
            );
          });
      },
      copyText: (value) => {
        void navigator.clipboard.writeText(value).then(
          () => {
            notify?.(locale === 'zh-CN' ? '已复制' : 'Copied', 'success');
          },
          () => {
            notify?.(locale === 'zh-CN' ? '复制失败' : 'Could not copy', 'error');
          },
        );
      },
      quoteInComposer: () => undefined,
      retryMessage: () => undefined,
      forkMessage: () => undefined,
      openSideChat: () => undefined,
      notify: (message, level) => {
        notify?.(message, level);
      },
    }),
    [addContextRef, locale, localFileActions, notify, onOpen],
  );

  const caps = {
    hasProject: hasProjectContext,
    canReveal: canActOnDisk,
    canSaveAs: canActOnDisk,
    sideChatAvailable: false,
    applyAvailable: true,
    canSendPreset: false,
    locale: locale as DesktopLocale,
  };

  const targetProjectPath = projectPath ?? '';
  const chip = (
    <a
      href="#"
      className={className}
      title={absolutePath}
      data-testid={testId}
      data-full-path={absolutePath}
      onClick={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      {showIcon ? <FileTypeIcon filePathOrExt={fullPath} size="1.05em" /> : null}
      <span className="chip-text">{displayText}</span>
    </a>
  );

  return (
    <ContextMenuFromCatalog
      testId="path-chip-context-menu"
      target={{
        surface: 'path-chip',
        projectPath: targetProjectPath,
        relativePath: resolvedRelative,
        absolutePath,
        label: displayText,
      }}
      caps={caps}
      dispatchers={dispatchers}
    >
      {chip}
    </ContextMenuFromCatalog>
  );
}
