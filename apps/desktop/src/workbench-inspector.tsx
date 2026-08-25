/**
 * Right-inspector column of the desktop workbench (extracted from App.tsx).
 * Host commands and document/open callbacks stay with App; this file is the view.
 */
import type { Dispatch, ReactElement, SetStateAction } from 'react';
import type {
  HostResponse,
  PromptContextRef,
  SessionPlan,
  ThemeManifest,
  TranscriptBranchPoint,
  WalkthroughArtifact,
  WebElementPickResult,
} from '@piwin/contracts';
import { BranchPointsPanel } from './branch-points-panel';
import type { HostClient } from './host-client';
import { RightPanel, type RightPanelTab } from './right-panel';
import { RIGHT_PANEL_DEFAULT_WIDTH_PX } from './right-panel-width';
import { RemoteUnavailableSurface } from './remote-unavailable-surface';
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
  DeferredChangesPanel,
  DeferredDocPreviewPanel,
  DeferredFileTreePanel,
  DeferredFlashcardsPanel,
  DeferredGitPanel,
  DeferredMediaDocPreview,
  DeferredNotesPanel,
  DeferredReviewPanel,
  DeferredSideChatPanel,
  DeferredTerminalDock,
} from './deferred-desktop-surfaces';

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
  addWebElement: (pick: WebElementPickResult) => void;
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
  branchPoints: TranscriptBranchPoint[];
  onSwitchBranch: (headMessageId: string) => void;
  streaming: boolean;
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
    addWebElement,
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
    branchPoints,
    onSwitchBranch,
    streaming,
  } = props;
  useBrowserInspectorReveal(hostClient, (tab) => {
    shell.openInspector(tab);
  });
  const hostPathStyle = hostClient.getRemoteCapabilities()?.pathStyle;

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
          onOpen={() => shell.openInspector(rightPanelTab)}
          onClose={() => shell.closeOverlay()}
          activeTab={rightPanelTab}
          onTabChange={(tab) => {
            shell.setInspectorTab(tab);
            if (!rightPanelOpen) {
              shell.openInspector(tab);
            }
          }}
          panelWidthPx={rightPanelResize.widthPx}
          isResizing={rightPanelResize.isResizing}
          onResizePointerDown={rightPanelResize.onResizePointerDown}
          onResizeReset={() => rightPanelResize.setWidthPx(RIGHT_PANEL_DEFAULT_WIDTH_PX)}
          isExpanded={rightPanelResize.widthPx > 450}
          onToggleExpand={() =>
            rightPanelResize.setWidthPx(
              rightPanelResize.widthPx > 450 ? RIGHT_PANEL_DEFAULT_WIDTH_PX : 600,
            )
          }
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
          branchesContent={
            <BranchPointsPanel
              branchPoints={branchPoints}
              disabled={streaming}
              onSwitch={(headMessageId) => void onSwitchBranch(headMessageId)}
              locale={locale}
            />
          }
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
                projectPath={projectPath}
                request={requestFileTree}
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
                locale={locale}
              />
            ) : (
              <RemoteUnavailableSurface feature="files" locale={locale} />
            )
          }
          canvasContent={
            <ArtifactCanvasPanel
              activeTarget={artifactTarget}
              artifactTheme={mapThemeToArtifactVariables(activeTheme)}
              artifactThemeKey={artifactThemeKey}
              {...(artifactMaxBytes !== undefined
                ? { artifactMaxBytes }
                : {})}
              onInsertProposal={(proposal) =>
                setComposer((current) => appendComposerProposal(current, proposal.text))
              }
            />
          }
          browserContent={
            hostClient.supportsCommand('browser/start') ? (
              <DeferredBrowserSessionPanel
                hostClient={hostClient}
                onAddWebElement={addWebElement}
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
              unavailableReason={
                activeDocument?.status === 'unavailable' ? activeDocument.reason : undefined
              }
              suggestion={
                activeDocument?.status === 'unavailable'
                  ? activeDocument.suggestion
                  : undefined
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
                  doc.path === `plans/${activeSessionId ?? ''}.md`
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
            hostClient.getTransport() !== 'remote' && hostClient.supportsCommand('pty/open') ? (
              <DeferredTerminalDock
                projectPath={projectPath}
                projectTrusted={projectTrusted}
                ptyOutput={ptyOutput}
                onClearPtyOutput={() => setPtyOutput([])}
                currentCwd={terminalCwd}
                onCwdChange={handleTerminalCwdChange}
                recentDirs={terminalRecentDirs}
                request={requestPty}
              />
            ) : (
              <RemoteUnavailableSurface feature="terminal" locale={locale} />
            )
          }
          reviewContent={
            hostClient.supportsCommand('git/status') ? (
              <DeferredReviewPanel
                changesContent={
                  <DeferredChangesPanel
                    projectPath={projectPath}
                    request={requestGit as never}
                    locale={locale}
                  />
                }
                gitContent={
                  <DeferredGitPanel
                    projectPath={projectPath}
                    request={requestGit as never}
                    variant="embedded"
                  />
                }
              />
            ) : (
              <RemoteUnavailableSurface feature="review" locale={locale} />
            )
          }
        />
      </>
  );
}
