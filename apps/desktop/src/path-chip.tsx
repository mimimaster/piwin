import { useMemo, type ReactElement } from 'react';
import type { PromptContextRef } from '@piwin/contracts';
import { FileTypeIcon } from '@piwin/ui-kit';
import { ContextMenuFromCatalog, type ContextMenuDispatchers } from './context-menu';
import type { DesktopLocale } from './desktop-locale';
import { useDesktopLocale } from './desktop-locale-context';

export type PathChipProps = {
  fullPath: string;
  onOpen: () => void;
  label?: string | undefined;
  className?: string | undefined;
  showIcon?: boolean | undefined;
  'data-testid'?: string | undefined;
  /** Optional project root — enables Add to Chat when onAddContextRef is set. */
  projectPath?: string | undefined;
  /** Optional path relative to project root. */
  relativePath?: string | undefined;
  onAddContextRef?: ((ref: PromptContextRef) => void) | undefined;
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
}: PathChipProps): ReactElement {
  const { locale } = useDesktopLocale();
  const displayText = label ?? fileNameFromPath(fullPath);
  const resolvedRelative = relativePath ?? relativePathFromFull(fullPath, projectPath);
  const hasProjectContext = Boolean(projectPath && onAddContextRef);

  const dispatchers: ContextMenuDispatchers = useMemo(
    () => ({
      addToChat: (ref) => {
        onAddContextRef?.(ref);
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
      revealPath: () => undefined,
      copyText: (value) => {
        void navigator.clipboard.writeText(value).catch(() => undefined);
      },
      quoteInComposer: () => undefined,
      retryMessage: () => undefined,
      forkMessage: () => undefined,
      openSideChat: () => undefined,
      notify: () => undefined,
    }),
    [onAddContextRef, onOpen],
  );

  const caps = {
    hasProject: hasProjectContext,
    canReveal: false,
    sideChatAvailable: false,
    applyAvailable: true,
    locale: locale as DesktopLocale,
  };

  const targetProjectPath = projectPath ?? '';
  const chip = (
    <a
      href="#"
      className={className}
      title={fullPath}
      data-testid={testId}
      data-full-path={fullPath}
      onClick={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      {showIcon ? <FileTypeIcon filePathOrExt={fullPath} /> : null}
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
        absolutePath: fullPath,
        label: displayText,
      }}
      caps={caps}
      dispatchers={dispatchers}
    >
      {chip}
    </ContextMenuFromCatalog>
  );
}
