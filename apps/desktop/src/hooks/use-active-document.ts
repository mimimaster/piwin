/**
 * Right-panel Doc Preview orchestration (extracted from App.tsx; ADR 0052).
 *
 * Owns the ActiveDocument state machine: every open gets a fresh request id so
 * stale async reads can never clobber a newer document. The Host is the path
 * interpreter now — this hook sends the raw clicked text once through
 * `preview/resolve-path` and hands the answer to `dispatchDocumentTarget`
 * (ADR 0052 §6). Local planning survives only as the fallback for a Host that
 * does not implement the command, and the transcript stays the last source of
 * truth before an unavailable state is shown.
 */
import { useCallback, useRef, useState } from 'react';
import type { HostClient } from '../host-client';
import type { DocumentOpenInput } from '../tool-call-card';
import { isBareExtensionPath } from '../document-open-path';
import { createDocumentRequestId, type ActiveDocument } from '../active-document';
import {
  requestedMarkupKind,
  resolveDocumentContentFromMessages,
  type DocumentContentMessage,
} from '../resolve-document-content';
import { hostResolvesDocumentPaths, requestDocumentPathResolution } from '../document-path-resolve';
import { dispatchDocumentTarget } from '../document-target-dispatch';
import { openViaLegacyPlanner } from '../document-loaders/legacy-path-open';
import {
  unavailableDocument,
  type DocumentLoaderContext,
  type ToolSnapshotRequest,
} from '../document-loaders/document-loader-context';

export type UseActiveDocumentInput = {
  hostClient: HostClient;
  /** Reveal the docPreview inspector tab (opens the panel when collapsed). */
  revealPreview: () => void;
  activeSessionId: string | null | undefined;
  projectPath: string | null | undefined;
  /** Host config root; used only for the local (fallback) classification. */
  piwinRoot?: string | null | undefined;
  messages: readonly DocumentContentMessage[];
};

export type UseActiveDocumentResult = {
  activeDocument: ActiveDocument | null;
  openDocument: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
};

export function useActiveDocument(input: UseActiveDocumentInput): UseActiveDocumentResult {
  const { hostClient, revealPreview, activeSessionId, projectPath, piwinRoot, messages } = input;
  const [activeDocument, setActiveDocument] = useState<ActiveDocument | null>(null);
  /** Guards stale async responses from overwriting a newer document request. */
  const activeDocumentRequestRef = useRef<string | null>(null);

  const openDocument = useCallback(
    (doc: DocumentOpenInput, target: 'stage' | 'inspector' = 'inspector') => {
      void target;
      const filePath = doc.path ?? doc.title;
      const cleanPath = (filePath || '').replace(/^file:\/\//, '');
      const rawName = cleanPath ? cleanPath.split(/[\\/]/).pop() || doc.title : doc.title;
      const cleanTitle = (rawName || 'Implementation Plan').replace(/\.md$/i, '');

      // Every open gets a fresh token; stale responses must not clobber a
      // newer document the user opened while this one was in flight.
      const requestId = createDocumentRequestId();
      activeDocumentRequestRef.current = requestId;
      const applyDocument = (next: ActiveDocument): void => {
        if (activeDocumentRequestRef.current === requestId) {
          setActiveDocument(next);
        }
      };

      revealPreview();

      const markupKind = requestedMarkupKind(cleanTitle, cleanPath);
      const bareExtension = isBareExtensionPath(cleanPath);
      const recoveredMarkupTitle =
        bareExtension && markupKind === 'svg'
          ? 'SVG'
          : bareExtension && markupKind === 'html'
            ? 'HTML'
            : cleanTitle;
      const recoveredMarkupPath =
        markupKind === 'svg'
          ? cleanPath.endsWith('.svg')
            ? cleanPath
            : 'preview.svg'
          : markupKind === 'html'
            ? /\.html?$/i.test(cleanPath)
              ? cleanPath
              : 'preview.html'
            : cleanPath;

      // Inline content is authoritative — including an explicit empty string.
      if (doc.content !== undefined) {
        applyDocument({
          status: 'ready',
          requestId,
          title: cleanTitle,
          content: doc.content,
          displayRef: cleanPath || cleanTitle,
          provenance: 'inline',
        });
        return;
      }

      if (!cleanPath && !doc.target) {
        applyDocument({
          status: 'unavailable',
          requestId,
          title: cleanTitle,
          displayRef: '',
          reason: 'no-path',
        });
        return;
      }

      // Recover body from transcript when the path was never written (e.g.
      // write_file permission deny) or host read failed. Must NOT grab the
      // first bare/ts fence — that produced half-cut plan panels.
      const searchInMessages = (): string | null =>
        resolveDocumentContentFromMessages({
          title: cleanTitle,
          path: cleanPath,
          messages,
        });

      const snapshotRequest: ToolSnapshotRequest = {
        messageId: doc.messageId,
        toolCallId: doc.toolCallId,
      };
      const context: DocumentLoaderContext = {
        hostClient,
        activeSessionId,
        projectPath,
        requestId,
        title: cleanTitle,
        displayRef: doc.target?.displayRef ?? cleanPath,
        apply: applyDocument,
        searchInMessages,
        snapshotRequest,
        requestToolSnapshot: (request) => readToolSnapshot(hostClient, activeSessionId, request),
      };

      // `.svg` / `.html` chips are extension mentions. Preview the fence from
      // the transcript instead of asking the workspace for a file named `.svg`.
      if (bareExtension || (!doc.target && markupKind && !cleanPath.includes('/'))) {
        const recovered = searchInMessages();
        if (recovered) {
          applyDocument({
            status: 'ready',
            requestId,
            title: recoveredMarkupTitle,
            content: recovered,
            displayRef: recoveredMarkupPath,
            filePath: recoveredMarkupPath,
            provenance: 'transcript',
          });
          return;
        }
        if (bareExtension) {
          applyDocument(
            unavailableDocument(
              { ...context, title: recoveredMarkupTitle },
              {
                reason: 'not-found',
                suggestion:
                  markupKind === 'svg'
                    ? '对话里没有找到可预览的 SVG。'
                    : markupKind === 'html'
                      ? '对话里没有找到可预览的 HTML。'
                      : '对话里没有找到可预览的内容。',
              },
            ),
          );
          return;
        }
      }

      // Structured logical target (Host-issued identity) — dispatch directly.
      if (doc.target) {
        dispatchDocumentTarget(context, doc.target);
        return;
      }

      // Raw path: the Host resolves it once (ADR 0052 §6), and Desktop only
      // renders by the target it answers with. A Host without the command
      // (older build, offline shell) falls back to the local planner.
      if (!hostResolvesDocumentPaths(hostClient)) {
        openViaLegacyPlanner({
          context,
          cleanPath,
          piwinRoot,
          markupChip: markupKind !== null,
        });
        return;
      }

      void (async () => {
        const resolution = await requestDocumentPathResolution(hostClient, {
          rawPath: cleanPath,
          projectPath: projectPath ?? undefined,
          sessionId: activeSessionId ?? undefined,
        });
        if (activeDocumentRequestRef.current !== requestId) {
          return;
        }
        if (resolution.kind === 'resolved') {
          dispatchDocumentTarget({ ...context, attempts: resolution.attempts }, resolution.target);
          return;
        }
        if (resolution.kind === 'unsupported') {
          openViaLegacyPlanner({
            context,
            cleanPath,
            piwinRoot,
            markupChip: markupKind !== null,
          });
          return;
        }
        // The Host named the reason; the conversation can still supply a body
        // (the file may never have been written, or was cleaned up since).
        const recovered = searchInMessages();
        if (recovered) {
          applyDocument({
            status: 'ready',
            requestId,
            title: cleanTitle,
            content: recovered,
            displayRef: cleanPath,
            provenance: 'transcript',
            warning: '展示来自对话记录的恢复内容，非当前磁盘版本。',
          });
          return;
        }
        applyDocument(
          unavailableDocument(
            { ...context, attempts: resolution.attempts },
            {
              reason: resolution.reason,
              ...suggestionForResolutionReason(resolution.reason),
            },
          ),
        );
      })();
    },
    [activeSessionId, hostClient, messages, piwinRoot, projectPath, revealPreview],
  );

  return { activeDocument, openDocument };
}

/** Recover the persisted tool output snapshot for a historical tool card. */
async function readToolSnapshot(
  hostClient: HostClient,
  activeSessionId: string | null | undefined,
  snapshotRequest: ToolSnapshotRequest,
): Promise<{ content: string; truncated: boolean } | null> {
  if (!activeSessionId || !snapshotRequest.messageId || !snapshotRequest.toolCallId) {
    return null;
  }
  const response = await hostClient.request({
    type: 'session/tool-output',
    sessionId: activeSessionId,
    messageId: snapshotRequest.messageId,
    toolCallId: snapshotRequest.toolCallId,
  });
  if (!response.success || !response.data) {
    return null;
  }
  const data = response.data as {
    status?: string;
    output?: string;
    truncated?: boolean;
  };
  if (data.status !== 'ready' || typeof data.output !== 'string') {
    return null;
  }
  return { content: data.output, truncated: data.truncated === true };
}

/**
 * A resolver failure is already specific; these cover the cases where the
 * panel should point at the next action rather than restate the code.
 */
function suggestionForResolutionReason(reason: string): { suggestion?: string } {
  switch (reason) {
    case 'outside-domains':
      return {
        suggestion:
          '该位置不在当前工作区、配置目录或可预览的主机路径内。若这是会话媒体，请从工具卡中的文档目标打开。',
      };
    case 'not-found':
      return { suggestion: '确认文件仍存在于磁盘上，路径拼写与大小写一致。' };
    case 'ambiguous-file':
      return { suggestion: '这名字在项目里不唯一，请从文件树中打开想要的那个。' };
    default:
      return {};
  }
}
