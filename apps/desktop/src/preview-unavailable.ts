import { fileExtension } from '@piwin/contracts';
import type { ActiveDocument } from './active-document.js';
import type { DesktopLocale } from './desktop-locale.js';

/** Matches `IMAGE_PREVIEW_MAX_BYTES` in host-runtime project file reads. */
export const FILE_TREE_IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

export type PreviewUnavailableCopy = {
  title: string;
  detail: string;
};

export function formatPreviewBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

export function classifyFileTreePreviewUnavailable(input: {
  mimeHint?: string | undefined;
  byteSize?: number | undefined;
}): 'binary' | 'too-large' {
  const mime = input.mimeHint?.toLowerCase() ?? '';
  const size = input.byteSize ?? 0;
  if (mime.startsWith('image/') && size > FILE_TREE_IMAGE_PREVIEW_MAX_BYTES) {
    return 'too-large';
  }
  return 'binary';
}

export function previewUnavailableCopy(input: {
  reason: string;
  locale: DesktopLocale;
  fileName?: string | undefined;
  byteSize?: number | undefined;
  maxBytes?: number | undefined;
}): PreviewUnavailableCopy {
  const zh = input.locale !== 'en';
  const extension = input.fileName ? fileExtension(input.fileName) : '';

  switch (input.reason) {
    case 'too-large':
      return {
        title: zh ? '文件太大，无法预览' : 'File is too large to preview',
        detail: tooLargeDetail(zh, input.byteSize, input.maxBytes),
      };
    case 'binary':
      return {
        title: zh ? '无法预览此文件' : 'Preview unavailable',
        detail: binaryDetail(zh, extension),
      };
    case 'not-found':
      return {
        title: zh ? '找不到此文件' : 'File not found',
        detail: zh ? '文件可能已被删除或清理。' : 'It may have been deleted or cleaned up.',
      };
    case 'not-a-file':
      return {
        title: zh ? '无法预览' : 'Preview unavailable',
        detail: zh ? '这不是一个文件。' : 'This path is not a file.',
      };
    case 'outside-domains':
      return {
        title: zh ? '无法预览' : 'Preview unavailable',
        detail: zh
          ? '这个路径不属于当前工作区、配置目录，也不是本机可读取的文件。'
          : 'This path is not in the workspace, the config store, or a readable file on the Host.',
      };
    case 'remote-local-path-denied':
      return {
        title: zh ? '远程 Host 不允许读取本机路径' : 'This Host will not read a path on your machine',
        detail: zh
          ? '你连接的是另一台机器上的 Host，它只能读取自己那台机器上的文件。请在 Host 所在机器上操作，或改用对话中的文件。'
          : 'You are connected to a Host on another machine; it can only read files on that machine. Open the file there, or use the file from the conversation instead.',
      };
    case 'outside-project':
    case 'outside-config-root':
    case 'media-vault':
      return {
        title: zh ? '无法预览' : 'Preview unavailable',
        detail: zh
          ? '该文件不在当前项目或可信目录内。'
          : 'This file is outside the current project or trusted folders.',
      };
    case 'project-root-missing':
      return {
        title: zh ? '工作区目录已不存在' : 'Workspace folder is gone',
        detail: zh
          ? '这个会话的项目目录已不在磁盘上（临时目录常被系统清理），因此其中的文件无法预览。'
          : 'This session’s project folder no longer exists on disk (temp folders get cleaned up), so its files cannot be previewed.',
      };
    case 'project-root-not-registered':
      return {
        title: zh ? '无法加载预览' : 'Preview unavailable',
        detail: zh
          ? '当前路径和已打开的项目对不上（常见于符号链接）。请从侧栏重新打开该文件夹。'
          : 'This path is not the registered project folder (a symlink alias can look like a different path). Re-open the project from the sidebar.',
      };
    case 'ambiguous-file':
      return {
        title: zh ? '找到多个同名文件' : 'Several files match',
        detail: zh
          ? '这名字在项目里不唯一，请从文件树中打开想要的那个。'
          : 'That name is not unique in this project — open the one you want from the file tree.',
      };
    case 'media-unavailable':
      return {
        title: zh ? '无法加载预览' : 'Preview unavailable',
        detail: zh ? '媒体文件当前无法读取。' : 'This media file cannot be read right now.',
      };
    case 'skill-unresolved':
      return {
        title: zh ? '无法预览' : 'Preview unavailable',
        detail: zh ? '找不到对应的 Skill 文档。' : 'The matching Skill document could not be found.',
      };
    case 'empty-path':
      return {
        title: zh ? '没有可打开的路径' : 'No path to open',
        detail: zh ? '这条记录里没有文件路径。' : 'This entry carries no file path.',
      };
    case 'invalid-request':
    case 'invalid-path':
    case 'no-path':
      return {
        title: zh ? '无法预览' : 'Preview unavailable',
        detail: zh ? '路径无效。' : 'The path is not valid.',
      };
    default:
      return {
        title: zh ? '无法加载预览' : 'Preview unavailable',
        detail: zh ? '文件当前无法读取。' : 'This file cannot be read right now.',
      };
  }
}

function tooLargeDetail(zh: boolean, byteSize?: number, maxBytes?: number): string {
  if (
    typeof byteSize === 'number' &&
    byteSize > 0 &&
    typeof maxBytes === 'number' &&
    maxBytes > 0
  ) {
    const size = formatPreviewBytes(byteSize);
    const limit = formatPreviewBytes(maxBytes);
    return zh ? `${size} 超过 ${limit} 预览上限` : `${size} exceeds the ${limit} preview limit`;
  }
  return zh ? '超过预览大小上限。' : 'This file exceeds the preview size limit.';
}

function binaryDetail(zh: boolean, extension: string): string {
  if (extension) {
    return zh ? `不支持预览 ${extension} 文件` : `${extension} files can’t be previewed`;
  }
  return zh ? '当前不支持这种格式。' : 'This file format can’t be previewed.';
}

export type ProjectReadPreviewInput = {
  content?: string | undefined;
  isBinary?: boolean | undefined;
  mimeHint?: string | undefined;
  byteSize?: number | undefined;
  previewDataUrl?: string | undefined;
  absolutePath?: string | undefined;
};

export type ProjectReadPreviewDecision =
  | { kind: 'text'; content: string }
  | {
      kind: 'media';
      path: string;
      dataUrl: string;
      mimeHint?: string;
      byteSize?: number;
    }
  | {
      kind: 'unavailable';
      reason: 'binary' | 'too-large';
      byteSize?: number;
      maxBytes?: number;
    }
  | { kind: 'continue' };

/**
 * Decide how Desktop should preview a successful `project/read-file`.
 * A binary read is never `not-found` — remote Hosts cannot use local ingest.
 */
export function interpretProjectReadPreview(
  data: ProjectReadPreviewInput,
): ProjectReadPreviewDecision {
  const previewDataUrl = data.previewDataUrl?.trim() ?? '';
  if (previewDataUrl.length > 0) {
    const path = data.absolutePath?.trim() || 'preview';
    return {
      kind: 'media',
      path,
      dataUrl: previewDataUrl,
      ...(data.mimeHint ? { mimeHint: data.mimeHint } : {}),
      ...(typeof data.byteSize === 'number' ? { byteSize: data.byteSize } : {}),
    };
  }
  if (data.isBinary === true) {
    const reason = classifyFileTreePreviewUnavailable({
      ...(data.mimeHint ? { mimeHint: data.mimeHint } : {}),
      ...(typeof data.byteSize === 'number' ? { byteSize: data.byteSize } : {}),
    });
    return {
      kind: 'unavailable',
      reason,
      ...(typeof data.byteSize === 'number' ? { byteSize: data.byteSize } : {}),
      ...(reason === 'too-large' ? { maxBytes: FILE_TREE_IMAGE_PREVIEW_MAX_BYTES } : {}),
    };
  }
  if (typeof data.content === 'string') {
    return { kind: 'text', content: data.content };
  }
  return { kind: 'continue' };
}

export function activeDocumentFromProjectRead(input: {
  data: ProjectReadPreviewInput;
  requestId: string;
  title: string;
  displayRef: string;
}): ActiveDocument | null {
  const decision = interpretProjectReadPreview(input.data);
  if (decision.kind === 'continue') {
    return null;
  }
  if (decision.kind === 'text') {
    return {
      status: 'ready',
      requestId: input.requestId,
      title: input.title,
      content: decision.content,
      displayRef: input.displayRef,
      provenance: 'project-current',
    };
  }
  if (decision.kind === 'media') {
    return {
      status: 'ready',
      requestId: input.requestId,
      title: input.title,
      content: '',
      displayRef: input.displayRef,
      provenance: 'project-current',
      media: {
        path: decision.path,
        dataUrl: decision.dataUrl,
        ...(decision.mimeHint ? { mimeType: decision.mimeHint } : {}),
        ...(decision.byteSize !== undefined ? { byteSize: decision.byteSize } : {}),
      },
    };
  }
  return {
    status: 'unavailable',
    requestId: input.requestId,
    title: input.title,
    displayRef: input.displayRef,
    reason: decision.reason,
    ...(decision.byteSize !== undefined ? { byteSize: decision.byteSize } : {}),
    ...(decision.maxBytes !== undefined ? { maxBytes: decision.maxBytes } : {}),
  };
}
