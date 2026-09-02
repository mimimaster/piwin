/**
 * Right-panel Doc Preview orchestration (extracted from App.tsx; ADR 0052).
 *
 * Owns the ActiveDocument state machine: every open gets a fresh request id so
 * stale async reads can never clobber a newer document. Routing is delegated
 * to the pure planner (document-open-path): project text → project/read-file,
 * skill targets → skills/read, media vault refs → media viewer, everything
 * else → trusted-config text, transcript recovery, or an explicit unavailable state.
 */
import { useCallback, useRef, useState } from 'react';
import type { HostClient } from '../host-client';
import type { DocumentOpenInput } from '../tool-call-card';
import {
  isBareExtensionPath,
  localPreviewPathForPlan,
  planDocumentOpenPath,
} from '../document-open-path';
import {
  createDocumentRequestId,
  type ActiveDocument,
} from '../active-document';
import {
  activeDocumentFromProjectRead,
  type ProjectReadPreviewInput,
} from '../preview-unavailable';
import {
  requestedMarkupKind,
  resolveDocumentContentFromMessages,
  type DocumentContentMessage,
} from '../resolve-document-content';
import { readMediaObjectUrlViaHost } from '../media-host-read';

export type UseActiveDocumentInput = {
  hostClient: HostClient;
  /** Reveal the docPreview inspector tab (opens the panel when collapsed). */
  revealPreview: () => void;
  activeSessionId: string | null | undefined;
  projectPath: string | null | undefined;
  /** Host config root; used only for local trusted-config classification. */
  piwinRoot?: string | null | undefined;
  messages: readonly DocumentContentMessage[];
};

export type UseActiveDocumentResult = {
  activeDocument: ActiveDocument | null;
  openDocument: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
};

/** Recover the persisted tool output snapshot for a historical tool card. */
function createToolSnapshotReader(
  hostClient: HostClient,
  activeSessionId: string | null | undefined,
): (input: { messageId?: string; toolCallId?: string }) => Promise<{
  content: string;
  truncated: boolean;
} | null> {
  return async (input) => {
    if (!activeSessionId || !input.messageId || !input.toolCallId) {
      return null;
    }
    const response = await hostClient.request({
      type: 'session/tool-output',
      sessionId: activeSessionId,
      messageId: input.messageId,
      toolCallId: input.toolCallId,
    });
    if (!response.success || !response.data) {
      return null;
    }
    const data = response.data as {
      status?: string;
      output?: string;
      truncated?: boolean;
      reason?: string;
    };
    if (data.status !== 'ready' || typeof data.output !== 'string') {
      return null;
    }
    return { content: data.output, truncated: data.truncated === true };
  };
}

export function useActiveDocument(input: UseActiveDocumentInput): UseActiveDocumentResult {
  const { hostClient, revealPreview, activeSessionId, projectPath, piwinRoot, messages } = input;
  const [activeDocument, setActiveDocument] = useState<ActiveDocument | null>(null);
  /** Guards stale async responses from overwriting a newer document request. */
  const activeDocumentRequestRef = useRef<string | null>(null);

  const requestToolSnapshot = useCallback(
    async (request: { messageId?: string; toolCallId?: string }) =>
      createToolSnapshotReader(hostClient, activeSessionId)(request),
    [hostClient, activeSessionId],
  );

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
      const recoveredMarkupTitle =
        isBareExtensionPath(cleanPath) && markupKind === 'svg'
          ? 'SVG'
          : isBareExtensionPath(cleanPath) && markupKind === 'html'
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

      // `.svg` / `.html` chips are extension mentions. Preview the fence from
      // the transcript instead of asking the workspace for a file named `.svg`.
      if (isBareExtensionPath(cleanPath) || (!doc.target && markupKind && !cleanPath.includes('/'))) {
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
        if (isBareExtensionPath(cleanPath)) {
          applyDocument({
            status: 'unavailable',
            requestId,
            title: recoveredMarkupTitle,
            displayRef: cleanPath,
            filePath: recoveredMarkupPath,
            reason: 'not-found',
            suggestion:
              markupKind === 'svg'
                ? '对话里没有找到可预览的 SVG。'
                : markupKind === 'html'
                  ? '对话里没有找到可预览的 HTML。'
                  : '对话里没有找到可预览的内容。',
          });
          return;
        }
      }

      const displayRef = doc.target?.displayRef ?? cleanPath;

      // Structured logical target (Host-issued identity).
      if (doc.target?.kind === 'media') {
        const sessionId = doc.target.sessionId;
        const assetId = doc.target.assetId;
        applyDocument({
          status: 'loading',
          requestId,
          title: cleanTitle,
          displayRef: displayRef || `media:${assetId}`,
          target: doc.target,
        });
        void (async () => {
          const objectUrl = await readMediaObjectUrlViaHost(hostClient, { sessionId, assetId });
          if (objectUrl) {
            applyDocument({
              status: 'ready',
              requestId,
              title: cleanTitle,
              content: '',
              displayRef: displayRef || `media:${assetId}`,
              provenance: 'session-media',
              media: {
                path: displayRef || `media:${assetId}`,
                assetId,
                dataUrl: objectUrl,
              },
            });
            return;
          }
          applyDocument({
            status: 'unavailable',
            requestId,
            title: cleanTitle,
            displayRef: displayRef || `media:${assetId}`,
            reason: 'media-unavailable',
            suggestion: '该媒体资源无法读取，可能已被清理或不可用。',
          });
        })();
        return;
      }

      if (doc.target?.kind === 'skill') {
        const skillId = doc.target.skillId;
        applyDocument({
          status: 'loading',
          requestId,
          title: cleanTitle,
          displayRef: displayRef || `skill:${skillId}`,
          target: doc.target,
        });
        void (async () => {
          // Prefer the snapshot the agent actually read for historical cards.
          const snapshot = await requestToolSnapshot(doc);
          if (snapshot) {
            applyDocument({
              status: 'ready',
              requestId,
              title: cleanTitle,
              content: snapshot.content,
              displayRef: displayRef || `skill:${skillId}`,
              provenance: 'tool-snapshot',
              ...(snapshot.truncated ? { warning: '该次工具输出被截断，只展示部分内容。' } : {}),
            });
            return;
          }
          const response = await hostClient.request({
            type: 'skills/read',
            skillId,
            ...(projectPath ? { projectPath } : {}),
          });
          if (response.success && response.data) {
            const skillData = response.data as {
              status?: string;
              content?: string;
              name?: string;
              skillId?: string;
              displayRef?: string;
              effectiveSource?: string;
              reason?: string;
              suggestion?: string;
            };
            if (skillData.status === 'ready' && typeof skillData.content === 'string') {
              applyDocument({
                status: 'ready',
                requestId,
                title: skillData.name?.trim() || skillData.skillId?.trim() || cleanTitle,
                content: skillData.content,
                displayRef: skillData.displayRef || displayRef || `skill:${skillId}`,
                provenance: 'current-resource',
                skillId: skillData.skillId || skillId,
                ...(skillData.effectiveSource ? { skillSource: skillData.effectiveSource } : {}),
                warning: '当前安装版本，可能不同于历史读取内容。',
              });
              return;
            }
            if (skillData.status === 'unavailable') {
              const msgFallback = searchInMessages();
              if (msgFallback) {
                applyDocument({
                  status: 'ready',
                  requestId,
                  title: skillData.skillId || cleanTitle,
                  content: msgFallback,
                  displayRef: skillData.displayRef || displayRef || `skill:${skillId}`,
                  provenance: 'transcript',
                  warning: '展示来自对话记录的恢复内容，非当前 Skill 版本。',
                });
              } else {
                applyDocument({
                  status: 'unavailable',
                  requestId,
                  title: skillData.skillId || cleanTitle,
                  displayRef: skillData.displayRef || displayRef || `skill:${skillId}`,
                  reason: skillData.reason || 'unavailable',
                  ...(skillData.suggestion ? { suggestion: skillData.suggestion } : {}),
                });
              }
              return;
            }
          }
          const msgFallback = searchInMessages();
          if (msgFallback) {
            applyDocument({
              status: 'ready',
              requestId,
              title: cleanTitle,
              content: msgFallback,
              displayRef: displayRef || `skill:${skillId}`,
              provenance: 'transcript',
              warning: '展示来自对话记录的恢复内容，非当前 Skill 版本。',
            });
            return;
          }
          applyDocument({
            status: 'unavailable',
            requestId,
            title: cleanTitle,
            displayRef: displayRef || `skill:${skillId}`,
            reason: 'skill-unresolved',
            suggestion: '打开 Skills 面板或重新同步内置 Skill。',
          });
        })();
        return;
      }

      if (doc.target?.kind === 'trusted-config') {
        const relativePath = doc.target.relativePath;
        applyDocument({
          status: 'loading',
          requestId,
          title: cleanTitle,
          displayRef: displayRef || relativePath,
          target: doc.target,
        });
        void loadTrustedConfigDocument({
          hostClient,
          relativePath,
          title: cleanTitle,
          displayRef: displayRef || relativePath,
          requestId,
          applyDocument,
          searchInMessages,
        });
        return;
      }

      if (doc.target?.kind === 'project-file') {
        const relativePath = doc.target.relativePath;
        applyDocument({
          status: 'loading',
          requestId,
          title: cleanTitle,
          displayRef: displayRef || relativePath,
          target: doc.target,
        });
        void (async () => {
          const snapshot = await requestToolSnapshot(doc);
          if (snapshot) {
            applyDocument({
              status: 'ready',
              requestId,
              title: cleanTitle,
              content: snapshot.content,
              displayRef: displayRef || relativePath,
              provenance: 'tool-snapshot',
              ...(snapshot.truncated ? { warning: '该次工具输出被截断，只展示部分内容。' } : {}),
            });
            return;
          }
          if (projectPath) {
            const response = await hostClient.request({
              type: 'project/read-file',
              projectPath,
              relativePath,
            });
            if (response.success && response.data) {
              const next = activeDocumentFromProjectRead({
                data: response.data as ProjectReadPreviewInput,
                requestId,
                title: cleanTitle,
                displayRef: displayRef || relativePath,
              });
              if (next) {
                applyDocument(next);
                return;
              }
            }
            const previewPath = localPreviewPathForPlan(
              planDocumentOpenPath({ path: relativePath, projectPath }),
            );
            if (previewPath && activeSessionId) {
              await loadLocalFilePreviewDocument({
                hostClient,
                sessionId: activeSessionId,
                absolutePath: previewPath,
                title: cleanTitle,
                displayRef: displayRef || relativePath,
                requestId,
                applyDocument,
              });
              return;
            }
          }
          const msgFallback = searchInMessages();
          if (msgFallback) {
            applyDocument({
              status: 'ready',
              requestId,
              title: cleanTitle,
              content: msgFallback,
              displayRef: displayRef || relativePath,
              provenance: 'transcript',
              warning: '展示来自对话记录的恢复内容，非当前磁盘版本。',
            });
          } else {
            applyDocument({
              status: 'unavailable',
              requestId,
              title: cleanTitle,
              displayRef: displayRef || relativePath,
              reason: 'not-found',
              suggestion: '确认文件仍存在于项目中。',
            });
          }
        })();
        return;
      }

      // Legacy local path routing (no structured target).
      if (!cleanPath) {
        applyDocument({
          status: 'unavailable',
          requestId,
          title: cleanTitle,
          displayRef: '',
          reason: 'no-path',
        });
        return;
      }

      // Only in-project paths may use project/read-file. Never invent a
      // project root from dirname(absolutePath) (skill / bundle paths).
      const openPlan = planDocumentOpenPath({
        path: cleanPath,
        projectPath,
        ...(piwinRoot ? { configRoot: piwinRoot } : {}),
      });

      // Media vault refs render through the media viewer (ADR 0052). Local
      // vault paths resolve via the Tauri asset protocol in the viewer. A bare
      // `remote-asset:<id>` path carries no session identity, so it cannot be
      // fetched — structured media targets (doc.target.kind === 'media') are
      // the correct remote path and carry sessionId + assetId.
      if (openPlan.kind === 'media') {
        if (openPlan.assetId !== null) {
          applyDocument({
            status: 'unavailable',
            requestId,
            title: cleanTitle,
            displayRef: cleanPath,
            reason: 'media-unavailable',
            suggestion: '该资源缺少会话标识，无法读取；请通过工具卡中的媒体目标打开。',
          });
          return;
        }
        applyDocument({
          status: 'ready',
          requestId,
          title: cleanTitle,
          content: '',
          displayRef: cleanPath,
          provenance: 'session-media',
          media: { path: openPlan.absolutePath },
        });
        return;
      }

      // ADR 0052 Slice 4: local Host previews whatever the UI can render.
      // Do not show outside-project for a file that is sitting on disk.
      if (openPlan.kind === 'legacy-absolute' && activeSessionId) {
        applyDocument({
          status: 'loading',
          requestId,
          title: cleanTitle,
          displayRef: cleanPath,
        });
        void loadLocalFilePreviewDocument({
          hostClient,
          sessionId: activeSessionId,
          absolutePath: openPlan.absolutePath,
          title: cleanTitle,
          displayRef: cleanPath,
          requestId,
          applyDocument,
        });
        return;
      }

      if (openPlan.kind === 'trusted-config') {
        applyDocument({
          status: 'loading',
          requestId,
          title: cleanTitle,
          displayRef: openPlan.displayPath,
        });
        void loadTrustedConfigDocument({
          hostClient,
          relativePath: openPlan.relativePath,
          title: cleanTitle,
          displayRef: openPlan.displayPath,
          requestId,
          applyDocument,
          searchInMessages,
        });
        return;
      }

      if (openPlan.kind === 'project' && openPlan.relativePath) {
        applyDocument({
          status: 'loading',
          requestId,
          title: cleanTitle,
          displayRef: cleanPath,
        });
        void (async () => {
          const snapshot = await requestToolSnapshot(doc);
          if (snapshot) {
            applyDocument({
              status: 'ready',
              requestId,
              title: cleanTitle,
              content: snapshot.content,
              displayRef: cleanPath,
              provenance: 'tool-snapshot',
              ...(snapshot.truncated ? { warning: '该次工具输出被截断，只展示部分内容。' } : {}),
            });
            return;
          }
          const response = await hostClient.request({
            type: 'project/read-file',
            projectPath: openPlan.projectPath,
            relativePath: openPlan.relativePath,
          });
          if (response.success && response.data) {
            const next = activeDocumentFromProjectRead({
              data: response.data as ProjectReadPreviewInput,
              requestId,
              title: cleanTitle,
              displayRef: cleanPath,
            });
            if (next) {
              applyDocument(next);
              return;
            }
          }
          const previewPath = localPreviewPathForPlan(openPlan);
          if (previewPath && activeSessionId) {
            await loadLocalFilePreviewDocument({
              hostClient,
              sessionId: activeSessionId,
              absolutePath: previewPath,
              title: cleanTitle,
              displayRef: cleanPath,
              requestId,
              applyDocument,
            });
            return;
          }
          const msgFallback = searchInMessages();
          if (msgFallback) {
            applyDocument({
              status: 'ready',
              requestId,
              title: cleanTitle,
              content: msgFallback,
              displayRef: cleanPath,
              provenance: 'transcript',
              warning: '展示来自对话记录的恢复内容，非当前磁盘版本。',
            });
          } else {
            applyDocument({
              status: 'unavailable',
              requestId,
              title: cleanTitle,
              displayRef: cleanPath,
              reason: 'not-found',
              suggestion: '确认文件仍存在于项目中。',
            });
          }
        })();
        return;
      }

      if (openPlan.kind === 'skill-legacy') {
        applyDocument({
          status: 'loading',
          requestId,
          title: openPlan.skillIdHint || cleanTitle,
          displayRef: cleanPath,
        });
        void (async () => {
          const snapshot = await requestToolSnapshot(doc);
          if (snapshot) {
            applyDocument({
              status: 'ready',
              requestId,
              title: openPlan.skillIdHint || cleanTitle,
              content: snapshot.content,
              displayRef: cleanPath,
              provenance: 'tool-snapshot',
              ...(snapshot.truncated ? { warning: '该次工具输出被截断，只展示部分内容。' } : {}),
            });
            return;
          }
          const response = await hostClient.request({
            type: 'skills/read',
            ...(openPlan.skillIdHint ? { skillId: openPlan.skillIdHint } : {}),
            legacyPath: openPlan.absolutePath,
            ...(projectPath ? { projectPath } : {}),
          });
          if (response.success && response.data) {
            const skillData = response.data as {
              status?: string;
              content?: string;
              name?: string;
              skillId?: string;
              displayRef?: string;
              effectiveSource?: string;
              reason?: string;
              suggestion?: string;
            };
            if (skillData.status === 'ready' && typeof skillData.content === 'string') {
              applyDocument({
                status: 'ready',
                requestId,
                title: skillData.name?.trim() || skillData.skillId?.trim() || cleanTitle,
                content: skillData.content,
                displayRef: skillData.displayRef || cleanPath,
                provenance: 'current-resource',
                ...(skillData.skillId ? { skillId: skillData.skillId } : {}),
                ...(skillData.effectiveSource ? { skillSource: skillData.effectiveSource } : {}),
                warning: '当前安装版本，可能不同于历史读取内容。',
              });
              return;
            }
            if (skillData.status === 'unavailable') {
              const msgFallback = searchInMessages();
              if (msgFallback) {
                applyDocument({
                  status: 'ready',
                  requestId,
                  title: skillData.skillId || openPlan.skillIdHint || cleanTitle,
                  content: msgFallback,
                  displayRef: skillData.displayRef || cleanPath,
                  provenance: 'transcript',
                  warning: '展示来自对话记录的恢复内容，非当前 Skill 版本。',
                });
              } else {
                applyDocument({
                  status: 'unavailable',
                  requestId,
                  title: skillData.skillId || openPlan.skillIdHint || cleanTitle,
                  displayRef: skillData.displayRef || cleanPath,
                  reason: skillData.reason || 'unavailable',
                  ...(skillData.suggestion ? { suggestion: skillData.suggestion } : {}),
                });
              }
              return;
            }
          }
          const msgFallback = searchInMessages();
          if (msgFallback) {
            applyDocument({
              status: 'ready',
              requestId,
              title: openPlan.skillIdHint || cleanTitle,
              content: msgFallback,
              displayRef: cleanPath,
              provenance: 'transcript',
              warning: '展示来自对话记录的恢复内容，非当前 Skill 版本。',
            });
            return;
          }
          applyDocument({
            status: 'unavailable',
            requestId,
            title: openPlan.skillIdHint || cleanTitle,
            displayRef: cleanPath,
            reason: 'skill-unresolved',
            suggestion: '打开 Skills 面板或重新同步内置 Skill。',
          });
        })();
        return;
      }

      const msgFallback = searchInMessages();
      const reason =
        markupKind
          ? 'not-found'
          : openPlan.kind === 'legacy-absolute' || openPlan.kind === 'relative-outside'
            ? 'outside-project'
            : 'not-found';
      if (msgFallback) {
        applyDocument({
          status: 'ready',
          requestId,
          title: cleanTitle,
          content: msgFallback,
          displayRef: cleanPath,
          provenance: 'transcript',
          warning: '展示来自对话记录的恢复内容。',
        });
      } else {
        applyDocument({
          status: 'unavailable',
          requestId,
          title: cleanTitle,
          displayRef: cleanPath,
          reason,
          ...(reason === 'outside-project'
            ? {
                suggestion:
                  '该位置不在当前工作区内。会话媒体会直接预览；受信配置请通过工具卡中的文档目标打开。其余路径可在访达中显示。',
              }
            : {}),
        });
      }
    },
    [
      activeSessionId,
      hostClient,
      messages,
      piwinRoot,
      projectPath,
      requestToolSnapshot,
      revealPreview,
    ],
  );

  return { activeDocument, openDocument };
}

async function loadTrustedConfigDocument(input: {
  hostClient: HostClient;
  relativePath: string;
  title: string;
  displayRef: string;
  requestId: string;
  applyDocument: (next: ActiveDocument) => void;
  searchInMessages: () => string | null;
}): Promise<void> {
  const response = await input.hostClient.request({
    type: 'preview/read-trusted-text',
    input: { relativePath: input.relativePath },
  });
  if (response.success && response.data) {
    const readData = response.data as {
      status?: string;
      content?: string;
      displayRef?: string;
      truncated?: boolean;
      reason?: string;
      suggestion?: string;
    };
    if (readData.status === 'ready' && typeof readData.content === 'string') {
      input.applyDocument({
        status: 'ready',
        requestId: input.requestId,
        title: input.title,
        content: readData.content,
        displayRef: readData.displayRef || input.displayRef,
        provenance: 'trusted-config',
        readOnly: true,
        ...(readData.truncated === true ? { warning: '内容已截断，只展示部分文本。' } : {}),
      });
      return;
    }
    if (readData.status === 'unavailable') {
      const fallback = input.searchInMessages();
      if (fallback) {
        input.applyDocument({
          status: 'ready',
          requestId: input.requestId,
          title: input.title,
          content: fallback,
          displayRef: readData.displayRef || input.displayRef,
          provenance: 'transcript',
          warning: '展示来自对话记录的恢复内容，非当前配置文件。',
        });
        return;
      }
      input.applyDocument({
        status: 'unavailable',
        requestId: input.requestId,
        title: input.title,
        displayRef: readData.displayRef || input.displayRef,
        reason: readData.reason || 'unavailable',
        ...(readData.suggestion ? { suggestion: readData.suggestion } : {}),
      });
      return;
    }
  }
  const fallback = input.searchInMessages();
  if (fallback) {
    input.applyDocument({
      status: 'ready',
      requestId: input.requestId,
      title: input.title,
      content: fallback,
      displayRef: input.displayRef,
      provenance: 'transcript',
      warning: '展示来自对话记录的恢复内容，非当前配置文件。',
    });
    return;
  }
  input.applyDocument({
    status: 'unavailable',
    requestId: input.requestId,
    title: input.title,
    displayRef: input.displayRef,
    reason: 'not-found',
    suggestion: '该受信配置文件无法读取，或已不存在。',
  });
}

async function loadLocalFilePreviewDocument(input: {
  hostClient: HostClient;
  sessionId: string;
  absolutePath: string;
  title: string;
  displayRef: string;
  requestId: string;
  applyDocument: (next: ActiveDocument) => void;
}): Promise<void> {
  const response = await input.hostClient.request({
    type: 'preview/read-local-file',
    input: { sessionId: input.sessionId, absolutePath: input.absolutePath },
  });
  if (response.success && response.data) {
    const previewData = response.data as {
      status?: string;
      kind?: string;
      content?: string;
      truncated?: boolean;
      asset?: {
        id?: string;
        absolutePath?: string;
        mimeType?: string;
        byteSize?: number;
      };
      reason?: string;
      suggestion?: string;
    };
    if (
      previewData.status === 'ready' &&
      previewData.kind === 'media' &&
      typeof previewData.asset?.absolutePath === 'string' &&
      previewData.asset.absolutePath.length > 0
    ) {
      input.applyDocument({
        status: 'ready',
        requestId: input.requestId,
        title: input.title,
        content: '',
        displayRef: input.displayRef,
        provenance: 'session-media',
        media: {
          path: previewData.asset.absolutePath,
          ...(typeof previewData.asset.id === 'string' ? { assetId: previewData.asset.id } : {}),
          ...(typeof previewData.asset.mimeType === 'string'
            ? { mimeType: previewData.asset.mimeType }
            : {}),
          ...(typeof previewData.asset.byteSize === 'number'
            ? { byteSize: previewData.asset.byteSize }
            : {}),
        },
      });
      return;
    }
    if (previewData.status === 'ready' && previewData.kind === 'text' && typeof previewData.content === 'string') {
      input.applyDocument({
        status: 'ready',
        requestId: input.requestId,
        title: input.title,
        content: previewData.content,
        displayRef: input.displayRef,
        provenance: 'project-current',
        readOnly: true,
        ...(previewData.truncated === true ? { warning: '内容已截断，只展示部分文本。' } : {}),
      });
      return;
    }
    if (previewData.status === 'unavailable') {
      const suggestion =
        previewData.suggestion ||
        (previewData.reason === 'binary'
          ? '该文件无法作为文档预览。请右键路径芯片选择另存为，或在文件管理器中显示。'
          : undefined);
      input.applyDocument({
        status: 'unavailable',
        requestId: input.requestId,
        title: input.title,
        displayRef: input.displayRef,
        reason: previewData.reason || 'not-found',
        ...(suggestion ? { suggestion } : {}),
      });
      return;
    }
  }
  input.applyDocument({
    status: 'unavailable',
    requestId: input.requestId,
    title: input.title,
    displayRef: input.displayRef,
    reason: 'not-found',
    suggestion: '该文件当前无法读取。',
  });
}
