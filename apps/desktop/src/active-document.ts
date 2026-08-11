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
  | 'transcript';

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

export function isActiveDocumentCopyable(doc: ActiveDocument | null | undefined): boolean {
  return doc?.status === 'ready' && doc.content.length > 0;
}
