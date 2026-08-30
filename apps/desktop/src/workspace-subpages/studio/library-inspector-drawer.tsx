import { useState, type ReactElement } from 'react';
import type { HostCommand, HostResponse, MediaLibraryItem } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale';
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconDownload,
  IconExpand,
  IconFile,
  IconSpark,
  IconTrash,
} from '../../shell-icons';
import { formatLibraryBytes, formatLibraryType } from './media-format';
import { usePlayableLibrarySrc } from './use-playable-library-src';

export type LibraryInspectorDrawerProps = {
  item: MediaLibraryItem | null;
  isOpen: boolean;
  onClose: () => void;
  locale?: DesktopLocale | undefined;
  request: (command: HostCommand) => Promise<HostResponse>;
  resolveSrc: (localPath: string, fallbackUrl: string) => string;
  onOpenLightbox: () => void;
  onDelete: () => void;
  onCopyPrompt: (text: string) => void;
  copied: boolean;
  onRemix?: ((prompt: string) => void) | undefined;
};

// Preset dynamic color extraction mockup for visual fidelity
const DEFAULT_PALETTES: Record<string, string[]> = {
  flux: ['#0B0E14', '#6366F1', '#EC4899', '#06B6D4', '#F59E0B'],
  midjourney: ['#111827', '#4F46E5', '#38BDF8', '#E2E8F0', '#64748B'],
  dalle: ['#0F172A', '#8B5CF6', '#38BDF8', '#EC4899', '#F8FAFC'],
  runway: ['#030712', '#9333EA', '#F43F5E', '#3B82F6', '#E0E7FF'],
  kling: ['#031024', '#06B6D4', '#3B82F6', '#67E8F9', '#1E3A8A'],
  default: ['#0F172A', '#6366F1', '#EC4899', '#F59E0B', '#10B981'],
};

function getPalette(model?: string): string[] {
  const m = (model || '').toLowerCase();
  if (m.includes('flux')) return DEFAULT_PALETTES.flux ?? DEFAULT_PALETTES.default!;
  if (m.includes('midjourney') || m.includes('mj')) return DEFAULT_PALETTES.midjourney ?? DEFAULT_PALETTES.default!;
  if (m.includes('dall')) return DEFAULT_PALETTES.dalle ?? DEFAULT_PALETTES.default!;
  if (m.includes('runway')) return DEFAULT_PALETTES.runway ?? DEFAULT_PALETTES.default!;
  if (m.includes('kling')) return DEFAULT_PALETTES.kling ?? DEFAULT_PALETTES.default!;
  return DEFAULT_PALETTES.default!;
}

export function LibraryInspectorDrawer(props: LibraryInspectorDrawerProps): ReactElement | null {
  const { item, isOpen, onClose } = props;
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const [copiedColor, setCopiedColor] = useState<string | null>(null);
  const localSrc = item?.absolutePath ? props.resolveSrc(item.absolutePath, '') : '';
  const src = usePlayableLibrarySrc({
    item: item ?? { kind: 'file', mimeType: '', sessionId: '', assetId: '' },
    localSrc,
    request: props.request,
    enabled: isOpen && item !== null,
  });

  if (!isOpen || !item) {
    return null;
  }
  const fileName = item.name?.trim() || item.assetId;
  const promptText = item.prompt?.trim() || fileName;
  const palette = getPalette(item.model);

  const copyColor = (hex: string) => {
    void navigator.clipboard.writeText(hex).catch(() => undefined);
    setCopiedColor(hex);
    window.setTimeout(() => setCopiedColor((prev) => (prev === hex ? null : prev)), 1500);
  };

  return (
    <aside
      className="lib-inspector"
      data-testid="library-inspector-drawer"
      aria-label={t('Asset Details', '资产详情')}
    >
      <header className="lib-inspector-head">
        <div className="lib-inspector-head-title">
          <span className="lib-inspector-dot" aria-hidden="true" />
          <h2 className="lib-inspector-title">{t('Asset Inspector', '资产检查器')}</h2>
        </div>
        <div className="lib-inspector-head-tools">
          <button
            type="button"
            className="lib-inspector-btn"
            onClick={props.onOpenLightbox}
            title={t('Open fullscreen', '全屏查看')}
            aria-label={t('Open fullscreen', '全屏查看')}
          >
            <IconExpand width={14} height={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lib-inspector-btn"
            onClick={onClose}
            title={t('Close inspector', '关闭属性面板')}
            aria-label={t('Close inspector', '关闭属性面板')}
          >
            <IconClose width={14} height={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="lib-inspector-body">
        {/* Large Media Preview Card */}
        <div className="lib-inspector-preview-card">
          {item.kind === 'video' ? (
            <div className="lib-inspector-video-wrapper">
              <video
                src={src || undefined}
                controls
                playsInline
                preload="metadata"
                className="lib-inspector-media is-video"
              />
            </div>
          ) : item.kind === 'image' ? (
            src ? (
              <img src={src} alt={promptText} className="lib-inspector-media" />
            ) : (
              <div className="lib-card-wait" />
            )
          ) : (
            <div className="lib-inspector-file-icon">
              <IconFile width={40} height={40} aria-hidden="true" />
              <span>{fileName}</span>
            </div>
          )}

          {item.model ? (
            <span className="lib-inspector-model-badge">{item.model}</span>
          ) : null}

          <button
            type="button"
            className="lib-inspector-theater-pill"
            onClick={props.onOpenLightbox}
          >
            <IconExpand width={12} height={12} aria-hidden="true" />
            <span>{t('Theater view', '全屏剧场')}</span>
          </button>
        </div>

        {/* Prompt Section */}
        <section className="lib-inspector-section">
          <div className="lib-inspector-sec-head">
            <span className="lib-inspector-sec-label">{t('Prompt', '提示词')}</span>
            <button
              type="button"
              className="lib-inspector-copy-link"
              onClick={() => props.onCopyPrompt(promptText)}
            >
              {props.copied ? (
                <IconCheck width={12} height={12} aria-hidden="true" />
              ) : (
                <IconCopy width={12} height={12} aria-hidden="true" />
              )}
              <span>{props.copied ? t('Copied', '已复制') : t('Copy prompt', '复制提示词')}</span>
            </button>
          </div>
          <div className="lib-inspector-prompt-box">
            <p>{promptText}</p>
          </div>
        </section>

        {/* Quick Actions */}
        <div className="lib-inspector-actions-grid">
          {props.onRemix ? (
            <Button
              variant="primary"
              size="compact"
              onClick={() => props.onRemix?.(promptText)}
              className="lib-inspector-action-remix"
            >
              <IconSpark width={14} height={14} aria-hidden="true" />
              <span>{t('Remix in Chat', '在会话中重绘')}</span>
            </Button>
          ) : null}

          {src ? (
            <a
              href={src}
              download={fileName}
              className="lib-inspector-download-link"
            >
              <IconDownload width={14} height={14} aria-hidden="true" />
              <span>{t('Download', '下载素材')}</span>
            </a>
          ) : null}
        </div>

        {/* Palette Extraction */}
        <section className="lib-inspector-section">
          <span className="lib-inspector-sec-label">{t('Color Palette', '主题色板')}</span>
          <div className="lib-inspector-palette-row">
            {palette.map((color) => (
              <button
                key={color}
                type="button"
                className="lib-inspector-color-swatch"
                style={{ backgroundColor: color }}
                title={`${t('Copy color', '点击复制')} ${color}`}
                onClick={() => copyColor(color)}
              >
                {copiedColor === color ? (
                  <IconCheck width={12} height={12} color="#fff" aria-hidden="true" />
                ) : null}
              </button>
            ))}
          </div>
        </section>

        {/* Technical Parameters */}
        <section className="lib-inspector-section">
          <span className="lib-inspector-sec-label">{t('Parameters & Meta', '技术参数与详情')}</span>
          <div className="lib-inspector-params-table">
            <div className="lib-inspector-param-row">
              <span className="param-k">{t('Kind', '类型')}</span>
              <span className="param-v">{formatLibraryType(item.mimeType)}</span>
            </div>
            {item.model ? (
              <div className="lib-inspector-param-row">
                <span className="param-k">{t('AI Model', '模型')}</span>
                <span className="param-v">{item.model}</span>
              </div>
            ) : null}
            <div className="lib-inspector-param-row">
              <span className="param-k">{t('Size', '体积')}</span>
              <span className="param-v">{formatLibraryBytes(item.byteSize)}</span>
            </div>
            <div className="lib-inspector-param-row">
              <span className="param-k">{t('Created', '创建时间')}</span>
              <span className="param-v">{new Date(item.createdAt).toLocaleString()}</span>
            </div>
            <div className="lib-inspector-param-row">
              <span className="param-k">{t('Session', '来源会话')}</span>
              <span className="param-v font-mono">{item.sessionId}</span>
            </div>
          </div>
        </section>

        {/* Danger zone delete */}
        <div className="lib-inspector-danger">
          <Button
            variant="danger"
            size="compact"
            onClick={props.onDelete}
            className="lib-inspector-delete-btn"
          >
            <IconTrash width={14} height={14} aria-hidden="true" />
            <span>{t('Delete from Vault', '从本地资料库删除')}</span>
          </Button>
        </div>
      </div>
    </aside>
  );
}
