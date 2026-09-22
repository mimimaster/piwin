/**
 * Right-inspector column of the desktop workbench (extracted from App.tsx).
 * Host commands and document/open callbacks stay with App; this file is the view.
 */
import {
  DOCKING_OWNED_INSPECTOR_TABS,
  inspectorTabToToolKind,
  toolKindToInspectorTab,
} from './workbench/docking/docking-tool-bridge.js';
import { closeView } from './workbench/docking/commands.js';
import { isMovableToolKind } from './workbench/docking/types.js';
import type { DockingWorkspaceController } from './workbench/docking/use-docking-workspace.js';
import type { Dispatch, ReactElement, ReactNode, SetStateAction } from 'react';
import type {
  HostResponse,
  PromptContextRef,
  SessionPlan,
  ThemeManifest,
  WalkthroughArtifact,
  WebElementPickResult,
} from '@piwin/contracts';
import type { HostClient } from './host-client';
import { RightPanel, type RightPanelDockedTools, type RightPanelTab } from './right-panel';
import { RIGHT_PANEL_DEFAULT_WIDTH_PX } from './right-panel-width';
import { RemoteUnavailableSurface } from './remote-unavailable-surface';
import { WorkbenchReviewSurface } from './workbench-review-surface';
import { ArtifactCanvasPanel } from './artifact-canvas-panel';
import { appendComposerProposal, type ArtifactCanvasTarget } from './artifact-canvas-model';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { FileDiffInspector } from './file-diff-inspector';
import {
  activeDocumentContent,
  activeDocumentFilePath,
  type ActiveDocument,
  type ActiveDocumentMedia,
} from './active-document';
import type { LineCommentItem } from './EnhancedMarkdownView';
import type { SessionDocItem } from './DocPreviewPanel';
import { formatPlanMarkdown } from './plan-card';
import { isSessionPlanDisplayPath } from './plan-document-path.js';
import type { DocumentOpenInput } from './tool-call-card';
import type { AddContextRefResult } from './hooks/use-composer-context-refs';
import type { PtyOutputLine } from './terminal-dock';
import type { DesktopLocale } from './desktop-locale';
import type { NotificationAction } from './notification-queue';
import type { HostRequestAdapters } from './host-request-adapters';
import { useBrowserInspectorReveal } from './hooks/use-browser-inspector-reveal';
import type { NotesPanelProps } from './NotesPanel';
import type { FlashcardsPanelProps } from './FlashcardsPanel';
import type { FileTreeRequest } from './file-tree-panel';
import {
  DeferredBrowserSessionPanel,
  DeferredDocPreviewPanel,
  DeferredFileTreePanel,
  DeferredFlashcardsPanel,
  DeferredMediaDocPreview,
  DeferredNotesPanel,
  DeferredSideChatPanel,
  DeferredTerminalDock,
} from './deferred-desktop-surfaces';
import {
  resolveInteractiveTerminalCwd,
  resolveInteractiveTerminalProjectPath,
} from './interactive-terminal-binding';
import { TerminalJobMonitor, type TerminalJobMonitorProps } from './terminal-job-monitor';
import { isTauriPtyAvailable } from './tauri-pty';
import { useTerminalSessions } from './use-terminal-sessions';

type InspectorShell = {
  closeOverlay: () => void;
  openInspector: (tab?: RightPanelTab | null) => void;
  setInspectorTab: (tab: RightPanelTab | null) => void;
  toggleSessions: () => void;
};

type InspectorResize = {
  widthPx: number;
  isResizing: boolean;
  onResizePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  setWidthPx: (widthPx: number) => void;
  isFullWidth: boolean;
  setFullWidth: (next: boolean) => void;
  toggleFullWidth: () => void;
};

export type WorkbenchInspectorProps = {
  showOverlayScrim: boolean;
  shell: InspectorShell;
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab | null;
  rightPanelResize: InspectorResize;
  isOverlayPresentation: boolean;
  runningJobCount: number;
  terminalAttention: boolean;
  onTerminalAttentionClear: () => void;
  onViewChange: Dispatch<SetStateAction<'home' | 'detail'>>;
  locale: DesktopLocale;
  activeTheme: ThemeManifest;
  onToggleAppearance: () => void;
  openSettingsSection: (section: 'skills' | 'tools' | 'general') => void;
  hostClient: HostClient;
  requestNotesPanel: NotesPanelProps['request'];
  requestCardsPanel: FlashcardsPanelProps['request'];
  requestFileTree: (command: FileTreeRequest) => Promise<HostResponse>;
  requestGit: HostRequestAdapters['requestGit'];
  requestPty: HostRequestAdapters['requestPty'];
  projectPath: string | null;
  onOpenWorkspace?: (() => void) | undefined;
  /** Chat falls back to the General workspace so generated files still preview. */
  fileBrowseRoot?: string | null;
  projectTrusted: boolean;
  activeSessionId: string | null;
  walkthroughsByMessageId: Record<string, WalkthroughArtifact>;
  addContextRef: (ref: PromptContextRef) => AddContextRefResult;
  dispatchNotification: Dispatch<NotificationAction>;
  handleSend: (text: string) => Promise<void>;
  setComposer: Dispatch<SetStateAction<string>>;
  artifactTarget: ArtifactCanvasTarget | null;
  artifactThemeKey: string;
  artifactMaxBytes?: number;
  artifactBlockExternalScripts?: boolean;
  artifactBlockExternalResources?: boolean;
  addWebElement: (pick: WebElementPickResult) => void;
  onAddImageFile?: (file: File) => void;
  inspectorDiff: { relativePath: string } | null;
  activeMedia: ActiveDocumentMedia | undefined;
  activeDocument: ActiveDocument | null;
  sessionDocuments: SessionDocItem[];
  handleOpenDocument: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
  handleCommentLine: (lineContent: string) => void;
  activeComments: LineCommentItem[];
  handleAddDocComment: (comment: { lineId: string; lineText: string; commentText: string }) => void;
  handleEditDocComment: (id: string, nextText: string) => void;
  handleDeleteDocComment: (id: string) => void;
  sessionPlan: SessionPlan | null;
  ptyOutput: PtyOutputLine[];
  setPtyOutput: Dispatch<SetStateAction<PtyOutputLine[]>>;
  terminalCwd: string;
  handleTerminalCwdChange: (cwd: string) => void;
  terminalRecentDirs: string[];
  tasksContent?: ReactNode;
  tasksActiveCount?: number;
  terminalJobMonitor?: Omit<TerminalJobMonitorProps, 'children' | 'locale'> | undefined;
  /**
   * Docking workspace owns browser/changes/canvas/doc hosts so the inspector
   * must not double-lease; they show up here as docked tabs instead.
   */
  docking?: DockingWorkspaceController | null;
};

export function WorkbenchInspector(props: WorkbenchInspectorProps): ReactElement {
  const {
    showOverlayScrim,
    shell,
    rightPanelOpen,
    rightPanelTab,
    rightPanelResize,
    isOverlayPresentation,
    runningJobCount,
    terminalAttention,
    onTerminalAttentionClear,
    onViewChange,
    locale,
    activeTheme,
    onToggleAppearance,
    openSettingsSection,
    hostClient,
    requestNotesPanel,
    requestCardsPanel,
    requestFileTree,
    requestGit,
    requestPty,
    projectPath,
    fileBrowseRoot,
    projectTrusted,
    activeSessionId,
    walkthroughsByMessageId,
    addContextRef,
    dispatchNotification,
    handleSend,
    setComposer,
    artifactTarget,
    artifactThemeKey,
    artifactMaxBytes,
    artifactBlockExternalScripts,
    artifactBlockExternalResources,
    addWebElement,
    onAddImageFile,
    inspectorDiff,
    activeMedia,
    activeDocument,
    sessionDocuments,
    handleOpenDocument,
    handleCommentLine,
    activeComments,
    handleAddDocComment,
    handleEditDocComment,
    handleDeleteDocComment,
    sessionPlan,
    ptyOutput,
    setPtyOutput,
    terminalCwd,
    handleTerminalCwdChange,
    terminalRecentDirs,
    tasksContent,
    tasksActiveCount,
    terminalJobMonitor,
  } = props;
  const docking = props.docking?.enabled ? props.docking : null;
  const workspaceOwnsMovableTools = docking !== null;
  const dockedTools = resolveDockedTools(docking, artifactTarget?.title ?? null);
  useBrowserInspectorReveal(hostClient, (tab) => {
    // Docking reveals the browser in the workspace itself.
    if (workspaceOwnsMovableTools) return;
    shell.openInspector(tab);
  });
  const hostPathStyle = hostClient.getRemoteCapabilities()?.pathStyle;
  const terminalProjectPath = resolveInteractiveTerminalProjectPath(projectPath);
  const terminalSpawnCwd = resolveInteractiveTerminalCwd({
    preferredCwd: terminalCwd,
    projectPath,
  });
  const terminalSessions = useTerminalSessions(
    terminalProjectPath,
    projectTrusted,
    isTauriPtyAvailable(),
    terminalSpawnCwd || terminalCwd,
  );
  const terminalDock = (
    <DeferredTerminalDock
      projectPath={terminalProjectPath}
      projectTrusted={projectTrusted}
      ptyOutput={ptyOutput}
      onClearPtyOutput={() => setPtyOutput([])}
      currentCwd={terminalSpawnCwd || terminalCwd}
      onCwdChange={handleTerminalCwdChange}
      recentDirs={terminalRecentDirs}
      request={requestPty}
      terminalSessions={terminalSessions}
    />
  );

  return (
      <>
        {showOverlayScrim ? (
          <button
            type="button"
            className="shell-overlay-scrim"
            data-testid="shell-overlay-scrim"
            aria-label="Close panel"
            onClick={() => shell.closeOverlay()}
          />
        ) : null}

        <RightPanel
          open={rightPanelOpen}
          terminalSessions={terminalSessions}
          onOpen={() => shell.openInspector(rightPanelTab)}
          onClose={() => {
            rightPanelResize.setFullWidth(false);
            shell.closeOverlay();
          }}
          activeTab={rightPanelTab}
          {...(dockedTools ? { handedOffTabs: DOCKING_OWNED_INSPECTOR_TABS, dockedTools } : {})}
          onTabChange={(tab) => {
            shell.setInspectorTab(tab);
            if (!rightPanelOpen) {
              shell.openInspector(tab);
            }
          }}
          panelWidthPx={rightPanelResize.widthPx}
          isResizing={rightPanelResize.isResizing}
          onResizePointerDown={rightPanelResize.onResizePointerDown}
          onResizeReset={() => {
            rightPanelResize.setFullWidth(false);
            rightPanelResize.setWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX);
          }}
          isExpanded={
            isOverlayPresentation
              ? rightPanelResize.widthPx > 450
              : rightPanelResize.isFullWidth
          }
          onToggleExpand={() => {
            if (isOverlayPresentation) {
              rightPanelResize.setWidthPx(
                rightPanelResize.widthPx > 450 ? RIGHT_PANEL_DEFAULT_WIDTH_PX : 600,
              );
              return;
            }
            rightPanelResize.toggleFullWidth();
          }}
          isOverlayPresentation={isOverlayPresentation}
          runningJobCount={runningJobCount}
          terminalAttention={terminalAttention}
          onTerminalAttentionClear={onTerminalAttentionClear}
          onViewChange={onViewChange}
          locale={locale}
          appearanceMode={activeTheme.mode === 'light' ? 'light' : 'dark'}
          onToggleAppearance={onToggleAppearance}
          onOpenSkills={() => openSettingsSection('skills')}
          onOpenMcp={() => openSettingsSection('tools')}
          onOpenSettings={() => openSettingsSection('general')}
          onToggleSessions={() => shell.toggleSessions()}
          notesContent={
            hostClient.supportsCommand('notes/list') ? (
              <DeferredNotesPanel
                request={requestNotesPanel}
                readOnly={!hostClient.supportsCommand('notes/write')}
              />
            ) : (
              <RemoteUnavailableSurface feature="notes" locale={locale} />
            )
          }
          cardsContent={
            hostClient.supportsCommand('flashcards/list') ? (
              <DeferredFlashcardsPanel request={requestCardsPanel} />
            ) : (
              <RemoteUnavailableSurface feature="flashcards" locale={locale} />
            )
          }
          filesContent={
            hostClient.supportsCommand('project/list-dir') ? (
              <DeferredFileTreePanel
                projectPath={fileBrowseRoot ?? projectPath}
                request={requestFileTree}
                locale={locale}
                activeTheme={activeTheme}
                {...(props.onOpenWorkspace ? { onOpenWorkspace: props.onOpenWorkspace } : {})}
                {...(hostPathStyle === undefined ? {} : { pathStyle: hostPathStyle })}
                onAddContextRef={(ref) => {
                  const result = addContextRef(ref);
                  if (!result.ok) {
                    dispatchNotification({
                      type: 'notify/push',
                      notification: {
                        level: 'warning',
                        message: 'Context chip limit reached (12). Remove one first.',
                      },
                    });
                    return;
                  }
                }}
                onSendPreset={(text, refs) => {
                  for (const ref of refs) {
                    addContextRef(ref);
                  }
                  void handleSend(text);
                }}
                onInsertPath={(absolutePath) => {
                  setComposer((current) =>
                    current.trim().length > 0
                      ? `${current.replace(/\s+$/, '')}\n${absolutePath}`
                      : absolutePath,
                  );
                }}
                {...(hostClient.supportsCommand('browser/navigate')
                  ? {
                      onOpenHtmlInBrowser: (absolutePath: string) => {
                        handleOpenDocument({
                          title: absolutePath.split(/[\\/]/).pop() || absolutePath,
                          path: absolutePath,
                        });
                      },
                    }
                  : {})}
              />
            ) : (
              <RemoteUnavailableSurface feature="files" locale={locale} />
            )
          }
          canvasContent={
            workspaceOwnsMovableTools ? null : (
            <ArtifactCanvasPanel
              activeTarget={artifactTarget}
              artifactTheme={mapThemeToArtifactVariables(activeTheme)}
              artifactThemeKey={artifactThemeKey}
              {...(artifactMaxBytes !== undefined ? { artifactMaxBytes } : {})}
              {...(artifactBlockExternalScripts !== undefined
                ? { artifactBlockExternalScripts }
                : {})}
              {...(artifactBlockExternalResources !== undefined
                ? { artifactBlockExternalResources }
                : {})}
              onInsertProposal={(proposal) =>
                setComposer((current) => appendComposerProposal(current, proposal.text))
              }
            />
            )
          }
          browserContent={
            workspaceOwnsMovableTools ? null : hostClient.supportsCommand('browser/start') ? (
              <DeferredBrowserSessionPanel
                hostClient={hostClient}
                onAddWebElement={addWebElement}
                {...(onAddImageFile === undefined ? {} : { onAddImageFile })}
                panelActions={{
                  expanded: isOverlayPresentation
                    ? rightPanelResize.widthPx > 450
                    : rightPanelResize.isFullWidth,
                  onToggleExpand: () => {
                    if (isOverlayPresentation) {
                      rightPanelResize.setWidthPx(
                        rightPanelResize.widthPx > 450 ? RIGHT_PANEL_DEFAULT_WIDTH_PX : 600,
                      );
                      return;
                    }
                    rightPanelResize.toggleFullWidth();
                  },
                  onClose: () => {
                    rightPanelResize.setFullWidth(false);
                    shell.closeOverlay();
                  },
                }}
              />
            ) : (
              <RemoteUnavailableSurface feature="browser" locale={locale} />
            )
          }
          sideChatContent={
            <DeferredSideChatPanel
              sessionId={activeSessionId}
              hostClient={hostClient}
            />
          }
          docPreviewContent={
            inspectorDiff && projectPath ? (
              <FileDiffInspector
                projectPath={projectPath}
                path={inspectorDiff.relativePath}
                request={requestGit as never}
              />
            ) : activeMedia ? (
              <DeferredMediaDocPreview
                title={activeDocument?.title}
                displayRef={activeDocument?.displayRef}
                media={activeMedia}
                locale={locale}
              />
            ) : (
            <DeferredDocPreviewPanel
              title={activeDocument?.title}
              content={activeDocumentContent(activeDocument)}
              filePath={activeDocumentFilePath(activeDocument)}
              artifactTheme={mapThemeToArtifactVariables(activeTheme)}
              status={activeDocument?.status}
              displayRef={activeDocument?.displayRef}
              provenance={
                activeDocument?.status === 'ready' ? activeDocument.provenance : undefined
              }
              warning={
                activeDocument?.status === 'ready' ? activeDocument.warning : undefined
              }
              skillId={
                activeDocument?.status === 'ready' ? activeDocument.skillId : undefined
              }
              skillSource={
                activeDocument?.status === 'ready' ? activeDocument.skillSource : undefined
              }
              readOnly={
                activeDocument?.status === 'ready' ? activeDocument.readOnly : undefined
              }
              {...(projectPath ? { projectPath } : {})}
              unavailableReason={
                activeDocument?.status === 'unavailable' ? activeDocument.reason : undefined
              }
              suggestion={
                activeDocument?.status === 'unavailable'
                  ? activeDocument.suggestion
                  : undefined
              }
              byteSize={
                activeDocument?.status === 'unavailable' ? activeDocument.byteSize : undefined
              }
              maxBytes={
                activeDocument?.status === 'unavailable' ? activeDocument.maxBytes : undefined
              }
              sessionDocuments={sessionDocuments}
              onOpenFile={(filePath) => {
                handleOpenDocument({
                  title: filePath.split(/[\\/]/).pop() || filePath,
                  path: filePath,
                });
              }}
              onCommentLine={handleCommentLine}
              comments={activeComments}
              onAddComment={handleAddDocComment}
              onEditComment={handleEditDocComment}
              onDeleteComment={handleDeleteDocComment}
              onSelectDocument={(doc) => {
                const planDocument =
                  doc.path && activeSessionId && isSessionPlanDisplayPath(doc.path, activeSessionId)
                    ? sessionPlan
                    : null;
                // Walkthrough virtual docs: resolve markdown content from the
                // in-memory artifact map (path: walkthroughs/<message-id>.md).
                const walkthroughMatch = doc.path?.match(/^walkthroughs\/(.+)\.md$/);
                const walkthroughArtifact = walkthroughMatch
                  ? walkthroughsByMessageId[walkthroughMatch[1] as string]
                  : undefined;
                handleOpenDocument({
                  title: doc.title,
                  ...(doc.path ? { path: doc.path } : {}),
                  ...(planDocument ? { content: formatPlanMarkdown(planDocument) } : {}),
                  ...(walkthroughArtifact?.status === 'ready'
                    ? { content: walkthroughArtifact.markdown }
                    : {}),
                });
              }}
              locale={locale}
            />
            )
          }
          terminalContent={
            terminalJobMonitor ? (
              <TerminalJobMonitor {...terminalJobMonitor} locale={locale}>
                {terminalDock}
              </TerminalJobMonitor>
            ) : (
              terminalDock
            )
          }
          reviewContent={
            <WorkbenchReviewSurface
              hostClient={hostClient}
              projectPath={projectPath}
              locale={locale}
              activeSessionId={activeSessionId}
              requestGit={requestGit}
            />
          }
          {...(tasksContent !== undefined ? { tasksContent } : {})}
          {...(tasksActiveCount !== undefined ? { tasksActiveCount } : {})}
        />
      </>
  );
}

/** Right-group tool views of the docking workspace, as right panel tabs. */
function resolveDockedTools(
  docking: DockingWorkspaceController | null,
  canvasTitle: string | null,
): RightPanelDockedTools | undefined {
  if (!docking) return undefined;
  const { state } = docking;
  const groupId = state.rightPanel.groupIds[0] ?? null;
  const group = groupId ? state.groups[groupId] : undefined;
  const tabs: RightPanelTab[] = [];
  for (const viewId of group?.viewIds ?? []) {
    const kind = state.views[viewId]?.kind;
    if (kind && isMovableToolKind(kind)) tabs.push(toolKindToInspectorTab(kind));
  }
  const title = canvasTitle?.trim();
  return {
    tabs,
    groupId,
    ...(title ? { labels: { canvas: title } } : {}),
    onClose: (tab) => {
      const kind = inspectorTabToToolKind(tab);
      const viewId = group?.viewIds.find((id) => state.views[id]?.kind === kind);
      if (viewId) docking.setState((current) => closeView(current, viewId));
    },
    slotRef: docking.setRightSlot,
    panelRef: docking.setRightPanelElement,
    onTitlebarChange: docking.setRightTitlebar,
  };
}
