/**
 * Context menu surfaces / actions / targets (CM spec).
 * Desktop view model only; Host sees PromptContextRef after map-to-ref.
 */
import type { MediaAttachmentRef } from '@piwin/contracts';
import type { DesktopLocale } from '../desktop-locale.js';

export type ContextMenuSurface =
  | 'file-tree-file'
  | 'file-tree-folder'
  | 'selection'
  | 'path-chip'
  | 'message-user'
  | 'message-assistant'
  | 'code-block'
  | 'diff-row'
  | 'tool-card'
  | 'terminal-selection'
  | 'error'
  | 'media-image';

export type ContextMenuActionId =
  | 'generate-flashcard'
  | 'add-to-chat'
  | 'ask-about'
  | 'copy-as-ref'
  | 'explain'
  | 'fix'
  | 'review'
  | 'tests'
  | 'explain-failure'
  | 'fix-error'
  | 'open'
  | 'reveal'
  | 'save-as'
  | 'copy'
  | 'copy-image'
  | 'copy-relative-path'
  | 'copy-absolute-path'
  | 'quote-in-composer'
  | 'retry'
  | 'truncate-after'
  | 'fork'
  | 'side-chat'
  | 'open-changed-files'
  | 'apply-to-file'
  | 'rerun-tool';

export type ContextMenuTarget =
  | {
      surface: 'file-tree-file' | 'file-tree-folder' | 'path-chip';
      projectPath: string;
      relativePath: string;
      absolutePath: string;
      label: string;
    }
  | {
      surface: 'selection' | 'code-block';
      projectPath?: string;
      relativePath?: string;
      absolutePath?: string;
      lineStart?: number;
      lineEnd?: number;
      selectedText: string;
      label: string;
    }
  | {
      surface: 'message-user' | 'message-assistant';
      sessionId: string;
      messageId: string;
      text: string;
      label: string;
      capabilities: {
        canRetry: boolean;
        canFork: boolean;
        canSideChat: boolean;
      };
    }
  | {
      surface: 'diff-row';
      projectPath: string;
      relativePath: string;
      snapshotText: string;
      label: string;
    }
  | {
      surface: 'tool-card';
      toolCallId?: string;
      toolName: string;
      outputText: string;
      relatedPath?: string;
      label: string;
      canRerun: boolean;
    }
  | {
      surface: 'terminal-selection';
      selectedText: string;
      label: string;
    }
  | {
      surface: 'error';
      title: string;
      detail: string;
      label: string;
      relatedPath?: string;
      lineStart?: number;
    }
  | {
      surface: 'media-image';
      label: string;
      fileName: string;
      mimeType: string;
      attachment: MediaAttachmentRef;
      sessionId?: string;
      assetId?: string;
      /** Local vault path when this Desktop can see the file. */
      absolutePath?: string;
      /** Full-resolution URL already loaded. Never a grid thumb. */
      srcUrl?: string;
      /** Hide View when the lightbox is already open. */
      inLightbox?: boolean;
    };

export type MediaImageTarget = Extract<ContextMenuTarget, { surface: 'media-image' }>;

export type ContextMenuCapabilities = {
  hasProject: boolean;
  canReveal: boolean;
  /** Shown on a disabled Reveal item (e.g. remote Host disk). */
  revealDisabledHint?: string;
  /** PathChip / file-tree / media-image: offer Save As when a read channel exists. */
  canSaveAs?: boolean;
  /** Composer can accept a vault image as a pending attachment. */
  canAddMediaAttachment?: boolean;
  sideChatAvailable: boolean;
  applyAvailable: boolean;
  /** CM-15: "Open changed files" for message surfaces (turn has changed paths). */
  openChangedFilesAvailable?: boolean;
  /** Preset AI actions that auto-send (needs active session + ready host). */
  canSendPreset: boolean;
  locale: DesktopLocale;
};

export type ContextMenuItemSpec =
  | {
      type: 'item';
      id: ContextMenuActionId;
      label: string;
      disabled?: boolean;
      danger?: boolean;
      testId: string;
      icon?: string;
      shortcut?: string;
      /** Native tooltip; used to explain a disabled item without bloating its label. */
      title?: string;
    }
  | { type: 'separator' }
  | {
      type: 'submenu';
      id: string;
      label: string;
      children: ContextMenuItemSpec[];
      icon?: string;
    };
