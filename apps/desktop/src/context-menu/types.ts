/**
 * Context menu surfaces / actions / targets (CM spec).
 * Desktop view model only; Host sees PromptContextRef after map-to-ref.
 */
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
  | 'error';

export type ContextMenuActionId =
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
  | 'copy'
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
    };

export type ContextMenuCapabilities = {
  hasProject: boolean;
  canReveal: boolean;
  sideChatAvailable: boolean;
  applyAvailable: boolean;
  /** CM-15: "Open changed files" for message surfaces (turn has changed paths). */
  openChangedFilesAvailable?: boolean;
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
    }
  | { type: 'separator' }
  | {
      type: 'submenu';
      id: string;
      label: string;
      children: ContextMenuItemSpec[];
      icon?: string;
    };
