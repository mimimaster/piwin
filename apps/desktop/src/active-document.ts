/**
 * Discriminated ActiveDocument model for Doc Preview (plan Slice 4).
 * Loading / unavailable are first-class states — not fake markdown stubs only.
 */
import type { DocumentTargetRef } from '@piwin/contracts';

export type DocumentProvenance =
  | 'inline'
  | 'project-current'
  | 'current-resource'
  | 'tool-snapshot'
  | 'transcript'
  | 'session-media'
  | 'trusted-config';

/**
 * Media payload on a ready document (ADR 0052). `path` is the vault path or
 * `remote-asset:<id>` ref. Bytes are resolved lazily: a local vault path goes
 * through the Tauri asset protocol in the viewer; a remote-asset ref carries
 * fetched bytes as `dataUrl` (via media/read) so no host path is needed.
 */
export type ActiveDocumentMedia = {
  path: string;
  assetId?: string;
  mimeType?: string;
  byteSize?: number;
  /** Pre-resolved bytes for remote assets; overrides asset-protocol lookup. */
  dataUrl?: string;
};

export type ActiveDocument =
  | {
      status: 'loading';
      requestId: string;
      title: string;
      displayRef: string;
      filePath?: string | null;
      target?: DocumentTargetRef;
    }
  | {
      status: 'ready';
      requestId: string;
      title: string;
      content: string;
      displayRef: string;
      filePath?: string | null;
      provenance: DocumentProvenance;
      warning?: string;
      skillId?: string;
      skillSource?: string;
      /** Present → render through the media viewer instead of the text viewer. */
      media?: ActiveDocumentMedia;
      /** Trusted-domain preview is never writable from the viewer. */
      readOnly?: true;
    }
  | {
      status: 'unavailable';
      requestId: string;
      title: string;
      displayRef: string;
      filePath?: string | null;
      reason: string;
      suggestion?: string;
    };

export function createDocumentRequestId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function provenanceLabel(
  provenance: DocumentProvenance,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): string {
  if (locale === 'en') {
    switch (provenance) {
      case 'inline':
        return 'From current message';
      case 'project-current':
        return 'Current disk version';
      case 'current-resource':
        return 'Current installed Skill (may differ from historical read)';
      case 'tool-snapshot':
        return 'From that tool call (may be truncated)';
      case 'transcript':
        return 'Recovered from conversation (snapshot)';
      case 'session-media':
        return 'Session media asset';
      case 'trusted-config':
        return 'Outside project · read-only';
      default:
        return provenance;
    }
  }
  switch (provenance) {
    case 'inline':
      return '来自当前消息';
    case 'project-current':
      return '当前磁盘版本';
    case 'current-resource':
      return '当前安装的 Skill（可能不同于历史读取内容）';
    case 'tool-snapshot':
      return '来自该次工具调用（可能截断）';
    case 'transcript':
      return '来自对话记录（快照）';
    case 'session-media':
      return '会话媒体';
    case 'trusted-config':
      return '项目外 · 只读';
    default:
      return provenance;
  }
}

/** Backward-compatible fields for session doc list / comments keying. */
export function activeDocumentTitle(doc: ActiveDocument | null | undefined): string | undefined {
  return doc?.title;
}

export function activeDocumentFilePath(
  doc: ActiveDocument | null | undefined,
): string | null | undefined {
  if (!doc) return undefined;
  if ('filePath' in doc) return doc.filePath;
  return doc.displayRef;
}

export function activeDocumentContent(doc: ActiveDocument | null | undefined): string | undefined {
  if (!doc || doc.status !== 'ready') return undefined;
  return doc.content;
}

/** Media payload when the ready document should render through the media viewer. */
export function activeDocumentMedia(
  doc: ActiveDocument | null | undefined,
): ActiveDocumentMedia | undefined {
  if (!doc || doc.status !== 'ready') return undefined;
  return doc.media;
}

export function isActiveDocumentCopyable(doc: ActiveDocument | null | undefined): boolean {
  return doc?.status === 'ready' && doc.content.length > 0;
}
