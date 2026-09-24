import type { ReactElement } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import type { DesktopLocale } from './desktop-locale.js';
import { IconFolderOpen } from './shell-icons.js';

export type FilePanelEmptyFallbackProps = {
  locale?: DesktopLocale | undefined;
  activeTheme?: ThemeManifest | undefined;
  onOpenWorkspace?: (() => void) | undefined;
  testId?: string | undefined;
};

type ThemeStyleKind = 'inkstone-paper' | 'inkstone-ink' | 'modern';

function detectThemeStyle(theme?: ThemeManifest | undefined): ThemeStyleKind {
  const themeId = theme?.id;
  const visualStyle = theme?.visualStyle;

  if (themeId === 'piwin-inkstone-ink') {
    return 'inkstone-ink';
  }
  if (themeId === 'piwin-inkstone-paper') {
    return 'inkstone-paper';
  }
  if (visualStyle === 'paper') {
    return 'inkstone-paper';
  }

  // Fallback to DOM dataset if activeTheme wasn't explicitly passed
  if (typeof document !== 'undefined') {
    const docId = document.documentElement.dataset.themeId;
    const docVisual = document.documentElement.dataset.themeVisualStyle;
    if (docId === 'piwin-inkstone-ink') {
      return 'inkstone-ink';
    }
    if (docId === 'piwin-inkstone-paper') {
      return 'inkstone-paper';
    }
    if (docVisual === 'paper') {
      return 'inkstone-paper';
    }
  }

  return 'modern';
}

function resolveCopy(style: ThemeStyleKind, locale: DesktopLocale) {
  const isZh = locale === 'zh-CN';

  switch (style) {
    case 'inkstone-paper':
      return {
        title: isZh ? '案头尚无文牍' : 'No files',
        desc: isZh
          ? '生成或打开文件后，可以在这里浏览和预览。'
          : 'Generated or opened files can be browsed and previewed here.',
        action: isZh ? '打开文件夹' : 'Open Folder',
        sealText: '牍',
      };
    case 'inkstone-ink':
      return {
        title: isZh ? '砚案静候新章' : 'No files',
        desc: isZh
          ? '生成或打开文件后，可以在这里浏览和预览。'
          : 'Generated or opened files can be browsed and previewed here.',
        action: isZh ? '打开文件夹' : 'Open Folder',
        sealText: '墨',
      };
    case 'modern':
    default:
      return {
        title: isZh ? '暂无文件' : 'No files',
        desc: isZh
          ? '生成或打开文件后，可以在这里浏览和预览。'
          : 'Generated or opened files can be browsed and previewed here.',
        action: isZh ? '打开文件夹' : 'Open Folder',
        sealText: null,
      };
  }
}

/**
 * Centered, theme-adaptive empty fallback for the files inspector panel.
 * Adapts iconography, typography, and accents across Inkstone (paper/ink),
 * Ink Wash, and modern Obsidian/Bone themes.
 */
export function FilePanelEmptyFallback({
  locale = 'zh-CN',
  activeTheme,
  onOpenWorkspace,
  testId = 'file-tree-empty-fallback',
}: FilePanelEmptyFallbackProps): ReactElement {
  const styleKind = detectThemeStyle(activeTheme);
  const copy = resolveCopy(styleKind, locale);

  return (
    <div
      className={`file-tree-empty-fallback ${styleKind}`}
      data-testid={testId}
      data-theme-style={styleKind}
    >
      <div className="file-tree-empty-content">
        {copy.sealText ? (
          <div className="file-tree-empty-visual inkstone" aria-hidden="true">
            <span
              className="seal file-tree-empty-seal"
              data-testid="file-tree-empty-seal"
              title={copy.sealText}
            >
              {copy.sealText}
            </span>
          </div>
        ) : (
          <div className="file-tree-empty-visual modern" aria-hidden="true">
            <div className="file-tree-empty-icon-box">
              <svg
                className="file-tree-empty-modern-icon"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="13" y2="17" />
              </svg>
            </div>
          </div>
        )}

        <h3 className="file-tree-empty-title" data-testid="file-tree-empty-title">
          {copy.title}
        </h3>

        <p className="file-tree-empty-desc" data-testid="file-tree-empty-desc">
          {copy.desc}
        </p>

        {onOpenWorkspace ? (
          <div className="file-tree-empty-action">
            <Button
              size="compact"
              variant="secondary"
              className="file-tree-empty-btn"
              data-testid="file-tree-empty-open-btn"
              onClick={onOpenWorkspace}
            >
              <IconFolderOpen width={14} height={14} aria-hidden="true" />
              <span>{copy.action}</span>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
