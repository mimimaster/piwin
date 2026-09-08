/**
 * App-level context-menu caps + dispatchers. App owns Host commands; this
 * module builds the value DesktopContextMenuProvider consumes.
 */
import type { Dispatch, SetStateAction } from 'react';
import type { PromptContextRef } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import type { AddContextRefResult } from '../hooks/use-composer-context-refs';
import { revealLocalFileInFolder } from '../local-file-actions.js';
import {
  canRevealInLocalFileManager,
  revealDisabledHint,
} from '../local-file-reveal-policy.js';
import type { NotificationAction } from '../notification-queue';
import type { RightPanelTab } from '../right-panel';
import { resolveProjectFilesystemRoot } from '../remote-session-hydrate.js';
import type { DocumentOpenInput } from '../tool-call-card';
import type { DesktopLocale } from '../desktop-locale';
import type { DesktopContextMenuValue } from './desktop-context-menu-context.js';
import type { ContextMenuDispatchers } from './dispatch.js';
import type { ContextMenuCapabilities } from './types.js';

export type DesktopContextMenuValueDeps = {
  projectPath: string | null;
  activeSessionId: string | null;
  hostReady: boolean;
  locale: DesktopLocale;
  hostClient: HostClient;
  addContextRef: (ref: PromptContextRef) => AddContextRefResult;
  dispatchNotification: Dispatch<NotificationAction>;
  handleOpenDocument: (doc: DocumentOpenInput) => void;
  handleRetryMessage: (messageId: string) => void;
  requestTruncateAfter: (messageId: string) => void;
  handleSend: (text: string) => void | Promise<void>;
  handleForkSession: (sessionId: string, messageId: string) => void | Promise<void>;
  setComposer: Dispatch<SetStateAction<string>>;
  openInspector: (tab?: RightPanelTab | null) => void;
};

export function quoteTextForComposer(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

export function appendQuotedComposerText(current: string, quoted: string): string {
  return current.trim().length > 0 ? `${current.trimEnd()}\n\n${quoted}` : quoted;
}

export function fileNameFromPath(path: string, fallback = 'File'): string {
  return path.split(/[\\/]/).pop() || fallback;
}

export function focusComposerInput(root: ParentNode = document): void {
  root.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')?.focus();
}

export function buildDesktopContextMenuCaps(input: {
  projectPath: string | null;
  activeSessionId: string | null;
  hostReady: boolean;
  locale: DesktopLocale;
  sideChatSupported: boolean;
  applySupported: boolean;
  openChangedFilesSupported: boolean;
}): ContextMenuCapabilities {
  const projectRoot = resolveProjectFilesystemRoot(input.projectPath);
  const canReveal = Boolean(projectRoot) && canRevealInLocalFileManager(projectRoot);
  return {
    hasProject: Boolean(input.projectPath),
    canReveal,
    ...(canReveal ? {} : { revealDisabledHint: revealDisabledHint(input.locale) }),
    sideChatAvailable: Boolean(input.activeSessionId && input.hostReady && input.sideChatSupported),
    applyAvailable: input.applySupported,
    openChangedFilesAvailable: Boolean(input.projectPath && input.openChangedFilesSupported),
    canSendPreset: Boolean(input.activeSessionId && input.hostReady),
    locale: input.locale,
  };
}

export function createDesktopContextMenuValue(
  deps: DesktopContextMenuValueDeps,
): DesktopContextMenuValue {
  const notify = (message: string, level: 'success' | 'error' | 'info'): void => {
    deps.dispatchNotification({ type: 'notify/push', notification: { level, message } });
  };
  const addRef = (ref: PromptContextRef): boolean => {
    const result = deps.addContextRef(ref);
    if (!result.ok) {
      notify('Context chip limit reached (12). Remove one first.', 'error');
      return false;
    }
    return true;
  };
  const caps = buildDesktopContextMenuCaps({
    projectPath: deps.projectPath,
    activeSessionId: deps.activeSessionId,
    hostReady: deps.hostReady,
    locale: deps.locale,
    sideChatSupported: deps.hostClient.supportsCommand('side-chat/open'),
    applySupported: deps.hostClient.supportsCommand('project/read-file'),
    openChangedFilesSupported: deps.hostClient.supportsCommand('project/read-file'),
  });
  const dispatchers: ContextMenuDispatchers = {
    addToChat: (ref) => {
      addRef(ref);
    },
    focusComposer: () => {
      focusComposerInput();
    },
    sendPreset: (text, refs) => {
      for (const ref of refs) {
        addRef(ref);
      }
      void deps.handleSend(text);
    },
    openPath: (absolutePath, relativePath) => {
      const title = fileNameFromPath(relativePath || absolutePath);
      deps.handleOpenDocument({ title, path: relativePath || absolutePath });
    },
    revealPath: (absolutePath) => {
      void revealLocalFileInFolder(absolutePath).then((result) => {
        if (result.ok) return;
        if (result.reason === 'not-desktop') {
          notify(
            deps.locale === 'zh-CN'
              ? '当前是浏览器预览，无法打开 Finder。请用桌面窗口。'
              : 'Show in Finder needs the desktop window, not the browser preview.',
            'error',
          );
          return;
        }
        if (result.reason === 'not-local') {
          notify(revealDisabledHint(deps.locale), 'info');
          return;
        }
        notify(
          deps.locale === 'zh-CN' ? '无法在文件管理器中打开' : 'Could not show in file manager',
          'error',
        );
      });
    },
    copyText: (value) => {
      void navigator.clipboard.writeText(value).catch(() => {
        notify('Could not copy to clipboard', 'error');
      });
    },
    quoteInComposer: (text) => {
      const quoted = quoteTextForComposer(text);
      deps.setComposer((current) => appendQuotedComposerText(current, quoted));
      window.setTimeout(() => {
        focusComposerInput();
      }, 0);
    },
    retryMessage: (messageId) => {
      deps.handleRetryMessage(messageId);
    },
    truncateAfterMessage: (messageId) => {
      deps.requestTruncateAfter(messageId);
    },
    forkMessage: (messageId) => {
      if (!deps.activeSessionId) return;
      void deps.handleForkSession(deps.activeSessionId, messageId);
    },
    openSideChat: (input) => {
      if (!deps.activeSessionId) return;
      void deps.hostClient
        .sideChatOpen(deps.activeSessionId, {
          ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
          ...(input.refs && input.refs.length > 0 ? { refs: input.refs } : {}),
        })
        .then((response) => {
          if (!response.success) {
            notify(`Could not open side chat: ${response.error}`, 'error');
            return;
          }
          deps.openInspector('sideChat');
        });
    },
    applyToFile: (payload) => {
      // Apply P1a only (write-file host command is not part of this
      // integration): copy + preview + notice; never a silent write.
      void navigator.clipboard.writeText(payload.text).catch(() => undefined);
      if (payload.suggestedPath) {
        const title = fileNameFromPath(payload.suggestedPath);
        deps.handleOpenDocument({ title, path: payload.suggestedPath });
      }
      notify(
        payload.suggestedPath
          ? `Code copied. Preview opened for ${payload.suggestedPath} — paste to apply.`
          : 'Code copied to clipboard — paste to apply.',
        'info',
      );
    },
    openChangedFiles: () => {
      deps.openInspector('review');
    },
    notify,
  };
  return { caps, dispatchers };
}
