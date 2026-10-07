/**
 * Workbench root values whose identity must survive a streamed token.
 *
 * Each of these was a fresh object (or closure) on every render — i.e. on
 * every token — and a changed context value makes React walk the whole tree
 * below it looking for consumers. They are assembled in one place so
 * `AppWorkbench` stays a composition root: hook orchestration plus layout.
 *
 * Every `useMemo`/`useCallback` dependency list here is copied verbatim from
 * the call site this was extracted from (commit 3d98b6f8 stabilised these
 * values). Do not merge or widen them.
 */
import { useCallback, useMemo } from 'react';
import { appendComposerProposal } from '../artifact-canvas-model';
import { SubAgentPanel } from '../SubAgentPanel';
import { useLatestCallback } from '../use-latest-callback';
import { useStableHandlers } from '../use-stable-handlers';
import { useStructuralValue } from '../use-structural-value';
import type { ChatUiState } from '../chat-ui-types';
import { useWorkbenchAppModel } from './use-workbench-app-model';
import type { WorkbenchShellChrome } from './use-workbench-shell-chrome';
import type { useWorkbenchKnowledge } from './use-workbench-knowledge';

type AppModel = ReturnType<typeof useWorkbenchAppModel>;
type ModelArgs = Parameters<typeof useWorkbenchAppModel>[0];
type Knowledge = ReturnType<typeof useWorkbenchKnowledge>;

export type WorkbenchStableValueInputs = {
  hostClient: ModelArgs['hostClient'];
  subagentInspectorToggle: AppModel['subagentInspectorToggle'];
  subagentInspectorPanel: AppModel['subagentInspectorPanel'];
  knowledgeSupported: boolean;
  knowledge: Knowledge;
  setComposer: AppModel['setComposer'];
  state: ChatUiState;
  desktopLocale: WorkbenchShellChrome['desktopLocale'];
  activeTheme: ModelArgs['activeTheme'];
  artifactThemeKey: AppModel['artifactThemeKey'];
  requestGit: AppModel['requestGit'];
  addWebElement: AppModel['addWebElement'];
  artifactCanvas: AppModel['artifactCanvas'];
  activeDocument: AppModel['activeDocument'];
  inspectorFileDiff: AppModel['inspectorFileDiff'];
  activeMedia: AppModel['activeMedia'];
  shell: WorkbenchShellChrome['shell'];
  rightPanelResize: WorkbenchShellChrome['rightPanelResize'];
  sessionDocuments: AppModel['sessionDocuments'];
  activeComments: AppModel['activeComments'];
  handleResumeSession: AppModel['handleResumeSession'];
  parentSessionId: ChatUiState['activeSessionId'];
  requestSubAgent: AppModel['requestSubAgent'];
  tasksChildren: ChatUiState['subagentChildren'][string][];
};

export function useWorkbenchStableValues(inputs: WorkbenchStableValueInputs) {
  const {
    hostClient,
    subagentInspectorToggle,
    subagentInspectorPanel,
    knowledgeSupported,
    knowledge,
    setComposer,
    state,
    desktopLocale,
    activeTheme,
    artifactThemeKey,
    requestGit,
    addWebElement,
    artifactCanvas,
    activeDocument,
    inspectorFileDiff,
    activeMedia,
    shell,
    rightPanelResize,
    sessionDocuments,
    activeComments,
    handleResumeSession,
    parentSessionId,
    requestSubAgent,
    tasksChildren,
  } = inputs;

  const requestLocalFile = useCallback(
    (command: Parameters<typeof hostClient.request>[0]) => hostClient.request(command),
    [hostClient],
  );
  const stableInspectorToggle = useStableHandlers(subagentInspectorToggle);
  const stableInspectorPanel = useStableHandlers(subagentInspectorPanel);
  const stableKnowledgeMounts = useStableHandlers(knowledgeSupported ? knowledge.mounts : null);
  const stableCitationActions = useStableHandlers(knowledge.citationActions);
  const insertCanvasProposal = useCallback(
    (text: string) => setComposer((current) => appendComposerProposal(current, text)),
    [setComposer],
  );
  const dockToolHosts = useStructuralValue({
    hostClient,
    locale: desktopLocale,
    activeTheme,
    artifactThemeKey,
    projectPath: state.projectPath,
    activeSessionId: state.activeSessionId,
    requestGit,
    addWebElement,
    artifactTarget: artifactCanvas.activeTarget,
    onInsertCanvasProposal: insertCanvasProposal,
    activeDocument,
    inspectorDiff: inspectorFileDiff.diff,
    ...(activeMedia ? { activeMedia } : {}),
  });

  // Inspector inputs that are rebuilt per render but rarely differ in content.
  const inspectorShell = useStructuralValue(shell);
  const inspectorResize = useStructuralValue(rightPanelResize);
  const inspectorSessionDocuments = useStructuralValue(sessionDocuments);
  const inspectorComments = useStructuralValue(activeComments);
  const openTaskSession = useLatestCallback(handleResumeSession);
  const tasksContent = useMemo(
    () => (
      <SubAgentPanel
        parentSessionId={parentSessionId}
        request={requestSubAgent}
        onOpenSession={openTaskSession}
        children={tasksChildren}
        batches={state.subagentBatches}
        invocations={state.subagentInvocations}
        streams={state.subagentStreams}
      />
    ),
    [
      parentSessionId,
      requestSubAgent,
      openTaskSession,
      tasksChildren,
      state.subagentBatches,
      state.subagentInvocations,
      state.subagentStreams,
    ],
  );

  return {
    requestLocalFile,
    stableInspectorToggle,
    stableInspectorPanel,
    stableKnowledgeMounts,
    stableCitationActions,
    dockToolHosts,
    inspectorShell,
    inspectorResize,
    inspectorSessionDocuments,
    inspectorComments,
    tasksContent,
  };
}
