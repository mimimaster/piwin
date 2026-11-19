/**
 * Desktop helpers for opening external `.md` / `.txt` prompt source files and
 * revealing their containing folder without editing inside the app.
 */
import { formatError } from '@piwin/contracts';
import {
  fileNameFromLocalPath,
  revealLocalFileInFolder,
  type RevealLocalFileResult,
} from '../../files/local-file-actions';
import { isTauriRuntime } from '../../host/tauri-pty';

export type PromptFileOpenResult =
  | { ok: true; mode: 'editor' | 'copied' }
  | { ok: false; message: string };

export function promptFileExtensionLabel(filePath: string): 'MD' | 'TXT' {
  return filePath.trim().toLowerCase().endsWith('.txt') ? 'TXT' : 'MD';
}

export function promptFileDisplayName(filePath: string): string {
  return fileNameFromLocalPath(filePath);
}

export function formatPromptByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
}

export function describePromptFileSource(
  filePath: string,
  options: {
    systemPromptsDir?: string | undefined;
    projectPath?: string | null | undefined;
    isZh: boolean;
  },
): { badge: string; compactPath: string } {
  const normalized = filePath.replace(/\\/g, '/');
  const globalRoot = options.systemPromptsDir?.replace(/\\/g, '/').replace(/\/+$/, '');
  if (globalRoot && normalized.startsWith(`${globalRoot}/`)) {
    return {
      badge: options.isZh ? '全局库' : 'Global',
      compactPath: normalized.slice(globalRoot.length + 1),
    };
  }
  const projectRoot = options.projectPath?.replace(/\\/g, '/').replace(/\/+$/, '');
  if (projectRoot && normalized.startsWith(`${projectRoot}/`)) {
    return {
      badge: options.isZh ? '项目' : 'Project',
      compactPath: normalized.slice(projectRoot.length + 1),
    };
  }
  return {
    badge: options.isZh ? '外部文件' : 'External',
    compactPath: filePath,
  };
}

async function copyTextFallback(text: string): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  } catch {
    // Clipboard may be unavailable in restricted contexts.
  }
}

export async function openPromptFileForEditing(
  filePath: string,
  isZh: boolean,
): Promise<PromptFileOpenResult> {
  if (!isTauriRuntime()) {
    await copyTextFallback(filePath);
    return { ok: true, mode: 'copied' };
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_prompt_file_in_editor', { path: filePath });
    return { ok: true, mode: 'editor' };
  } catch (error) {
    await copyTextFallback(filePath);
    const detail = formatError(error);
    return {
      ok: false,
      message: isZh
        ? `无法直接打开源文件（已复制路径）：${detail}`
        : `Could not open source file (path copied): ${detail}`,
    };
  }
}

export async function revealPromptFileInFolder(
  filePath: string,
): Promise<RevealLocalFileResult> {
  return revealLocalFileInFolder(filePath);
}
