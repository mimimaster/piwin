/**
 * Controlled supported-file checklist for folder ingest / generate.
 * Unsupported files are listed read-only and never enter `selected`.
 */
import { type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { DocumentManifest, ScannedDocFile, ScannedFileV2 } from '@piwin/contracts';
import { useDesktopLocale } from '../desktop-locale-context.js';

export type KnowledgeFileChecklistProps = {
  files: ScannedDocFile[];
  unsupported: ScannedFileV2[];
  selected: string[];
  documents: DocumentManifest[];
  disabled: boolean;
  onChange: (nextSelected: string[]) => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function unsupportedReasonCopy(
  reason: ScannedFileV2['unsupportedReason'],
  t: (en: string, zh: string) => string,
): string {
  if (reason === 'MINERU_NOT_CONFIGURED') return t('MinerU not configured', '未配置 MinerU');
  if (reason === 'UNSTRUCTURED_NOT_CONFIGURED') {
    return t('Unstructured not configured', '未配置 Unstructured');
  }
  return t('Unsupported type', '不支持的格式');
}

export function KnowledgeFileChecklist(props: KnowledgeFileChecklistProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const ready = new Set(
    props.documents.filter((document) => document.status === 'READY').map((document) => document.relativePath),
  );
  const selectedSet = new Set(props.selected);
  const allSelected = props.files.length > 0 && props.files.every((file) => selectedSet.has(file.relativePath));

  function toggle(relativePath: string, checked: boolean): void {
    if (checked) {
      if (selectedSet.has(relativePath)) {
        props.onChange(props.selected);
        return;
      }
      props.onChange([...props.selected, relativePath]);
      return;
    }
    props.onChange(props.selected.filter((path) => path !== relativePath));
  }

  return (
    <div className="knowledge-file-checklist" data-testid="knowledge-file-checklist">
      <div className="knowledge-file-checklist-toolbar">
        <Button
          size="compact"
          variant="ghost"
          onClick={() => props.onChange(props.files.map((file) => file.relativePath))}
          disabled={props.disabled || allSelected}
        >
          {t('Select all', '全选')}
        </Button>
        <Button
          size="compact"
          variant="ghost"
          onClick={() => props.onChange([])}
          disabled={props.disabled || props.selected.length === 0}
        >
          {t('Deselect all', '全不选')}
        </Button>
      </div>
      <ul className="knowledge-file-list">
        {props.files.map((file) => {
          const isReady = ready.has(file.relativePath);
          return (
            <li key={file.relativePath} className="knowledge-file-item">
              <label className="knowledge-file-label">
                <input
                  type="checkbox"
                  data-path={file.relativePath}
                  checked={selectedSet.has(file.relativePath)}
                  disabled={props.disabled}
                  onChange={(event) => toggle(file.relativePath, event.currentTarget.checked)}
                />
                <span className="knowledge-file-path">{file.relativePath}</span>
                <span className="knowledge-file-ext">{file.language || 'text'}</span>
                <span className="knowledge-file-size">{formatBytes(file.sizeBytes)}</span>
                {isReady ? (
                  <span className="knowledge-file-ready" data-testid={`file-ready-${file.relativePath}`}>
                    {t('Ready', '已入库')}
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
      {props.unsupported.length > 0 ? (
        <div className="knowledge-file-unsupported" data-testid="knowledge-file-unsupported">
          <span className="knowledge-file-unsupported-title">
            {t(
              `${props.unsupported.length} files skipped:`,
              `跳过 ${props.unsupported.length} 个不支持的文件：`,
            )}
          </span>
          <ul className="knowledge-file-unsupported-list">
            {props.unsupported.map((file) => (
              <li key={file.relativePath}>
                <span>{file.relativePath}</span>
                <span className="knowledge-file-unsupported-reason">
                  {unsupportedReasonCopy(file.unsupportedReason, t)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
