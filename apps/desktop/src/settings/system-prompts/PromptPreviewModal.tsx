/**
 * Minimal read-only modal preview for stacked prompt files and built-in slots.
 */
import { useEffect, useState, type ReactElement } from 'react';
import {
  Button,
  IconCopy,
  IconDocument,
  IconEdit,
  IconFolderOpen,
  Modal,
  Notice,
  StatusBadge,
  type StatusTone,
} from '@piwin/ui-kit';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import {
  formatPromptByteSize,
  openPromptFileForEditing,
  revealPromptFileInFolder,
} from './prompt-file-actions';

export type PromptPreviewLayer = {
  id: string;
  label: string;
  badge?: string;
  filePath?: string;
  content: string;
  missing?: boolean;
  error?: string;
  sizeBytes?: number;
};

export type PromptPreviewPayload = {
  title: string;
  badge?: string;
  badgeTone?: StatusTone;
  layers: PromptPreviewLayer[];
  initialLayerId?: string;
};

export function PromptPreviewModal(props: {
  payload: PromptPreviewPayload | null;
  onClose: () => void;
  onNotice?: (message: string, tone?: 'info' | 'success' | 'warning') => void;
  onError?: (message: string) => void;
}): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const { payload, onClose, onNotice, onError } = props;

  const [activeLayerId, setActiveLayerId] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!payload) return;
    setCopied(false);
    setActiveLayerId(payload.initialLayerId ?? payload.layers[0]?.id ?? '');
  }, [payload]);

  const activeLayer =
    payload?.layers.find((layer) => layer.id === activeLayerId) ?? payload?.layers[0];
  const canCopy = Boolean(activeLayer && !activeLayer.missing && activeLayer.content.length > 0);
  const lineCount = activeLayer?.content ? activeLayer.content.split(/\r?\n/).length : 0;
  const charCount = activeLayer?.content.length ?? 0;

  async function handleCopy(): Promise<void> {
    if (!activeLayer || !canCopy) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(activeLayer.content);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      onError?.(isZh ? '复制失败。' : 'Copy failed.');
    }
  }

  async function handleOpenExternal(): Promise<void> {
    if (!activeLayer?.filePath) return;
    const result = await openPromptFileForEditing(activeLayer.filePath, isZh);
    if (result.ok) {
      onNotice?.(
        result.mode === 'editor'
          ? isZh
            ? '已在外部编辑器打开源文件。'
            : 'Opened in external editor.'
          : isZh
            ? '已复制文件路径。'
            : 'Path copied.',
        'info',
      );
      return;
    }
    onError?.(result.message);
  }

  async function handleReveal(): Promise<void> {
    if (!activeLayer?.filePath) return;
    const result = await revealPromptFileInFolder(activeLayer.filePath);
    if (!result.ok) {
      onError?.(isZh ? '无法定位源文件目录。' : 'Could not reveal file.');
    }
  }

  const hasMultipleLayers = (payload?.layers.length ?? 0) > 1;

  return (
    <Modal
      open={payload !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="lg"
      testId="system-prompts-preview-modal"
      title={
        payload ? (
          <div className="sysprompt-modal-title-wrap">
            <span className="sysprompt-modal-title-icon" aria-hidden="true">
              <IconDocument size={15} />
            </span>
            <span className="sysprompt-modal-title-text">{payload.title}</span>
            {payload.badge ? (
              <StatusBadge
                tone={payload.badgeTone ?? 'neutral'}
                label={payload.badge}
                showDot={false}
              />
            ) : null}
          </div>
        ) : undefined
      }
    >
      {payload && activeLayer ? (
        <div className="sysprompt-preview-body" data-testid="system-prompts-preview-body">
          <div className="sysprompt-preview-toolbar">
            {hasMultipleLayers ? (
              <div
                className="sysprompt-preview-layers"
                role="tablist"
                aria-label={isZh ? '提示词层级' : 'Prompt layers'}
              >
                {payload.layers.map((layer) => {
                  const selected = layer.id === activeLayer.id;
                  return (
                    <button
                      key={layer.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      title={layer.filePath}
                      data-testid={`sysprompt-preview-layer-${layer.id}`}
                      className={`sysprompt-layer-tab${selected ? ' is-active' : ''}${
                        layer.missing ? ' is-missing' : ''
                      }`}
                      onClick={() => {
                        setCopied(false);
                        setActiveLayerId(layer.id);
                      }}
                    >
                      <span>{layer.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="sysprompt-preview-meta">
                {activeLayer.filePath ? (
                  <code className="sysprompt-preview-path" title={activeLayer.filePath}>
                    {activeLayer.filePath}
                  </code>
                ) : (
                  <span className="sysprompt-preview-stats">
                    {isZh
                      ? `${charCount.toLocaleString()} 字 · ${lineCount} 行`
                      : `${charCount.toLocaleString()} chars · ${lineCount} lines`}
                  </span>
                )}
                {activeLayer.filePath && !activeLayer.missing ? (
                  <span className="sysprompt-preview-stats">
                    {formatPromptByteSize(activeLayer.sizeBytes ?? 0)}
                  </span>
                ) : null}
              </div>
            )}

            <div className="sysprompt-preview-actions">
              {activeLayer.filePath ? (
                <>
                  <Button
                    size="compact"
                    variant="secondary"
                    onClick={() => void handleOpenExternal()}
                    title={activeLayer.filePath}
                    data-testid="sysprompt-preview-open-external"
                  >
                    <IconEdit size={13} />
                    <span>{isZh ? '编辑源文件' : 'Edit file'}</span>
                  </Button>
                  <Button
                    size="compact"
                    variant="ghost"
                    onClick={() => void handleReveal()}
                    title={isZh ? '在文件夹中显示' : 'Reveal in folder'}
                    aria-label={isZh ? '在文件夹中显示' : 'Reveal in folder'}
                    data-testid="sysprompt-preview-reveal"
                  >
                    <IconFolderOpen size={13} />
                  </Button>
                </>
              ) : null}
              <Button
                size="compact"
                variant="ghost"
                disabled={!canCopy}
                onClick={() => void handleCopy()}
                data-testid="sysprompt-preview-copy"
              >
                <IconCopy size={13} />
                <span>{copied ? (isZh ? '已复制' : 'Copied') : isZh ? '复制' : 'Copy'}</span>
              </Button>
            </div>
          </div>

          {hasMultipleLayers && activeLayer.filePath ? (
            <div className="sysprompt-preview-subpath" title={activeLayer.filePath}>
              <code>{activeLayer.filePath}</code>
              {!activeLayer.missing ? (
                <span>
                  {formatPromptByteSize(activeLayer.sizeBytes ?? 0)} · {lineCount}{' '}
                  {isZh ? '行' : 'lines'}
                </span>
              ) : null}
            </div>
          ) : null}

          {activeLayer.missing ? (
            <Notice tone="warning" testId="sysprompt-preview-missing-notice">
              {isZh
                ? `无法读取源文件（${activeLayer.error ?? '文件不存在'}）`
                : `Source file unavailable (${activeLayer.error ?? 'not found'}).`}
            </Notice>
          ) : (
            <pre
              className="sysprompt-preview-code"
              tabIndex={0}
              data-testid="system-prompts-preview-content"
            >
              <code>{activeLayer.content || (isZh ? '（空文件）' : '(Empty file)')}</code>
            </pre>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
