import type { ReactElement, ReactNode } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer.js';
import { ConversationPaneWorkspace } from './conversation-pane-workspace.js';
import type { ConversationPaneLayoutController } from './use-conversation-pane-layout.js';
import type { HostClient } from './host-client.js';
import type { ArtifactCanvasTarget } from './artifact-canvas-model.js';
import type { DocumentOpenInput } from './tool-call-card.js';
import type { MediaPreviewReader } from './transcript-media-preview.js';
import { DockingWorkspace } from './workbench/docking/docking-workspace.js';
import type { DockingWorkspaceController } from './workbench/docking/use-docking-workspace.js';

export type WorkbenchConversationStageProps = {
  primaryPane: ReactNode;
  dockingEnabled: boolean;
  docking: DockingWorkspaceController;
  conversationPanesEnabled: boolean;
  conversationPaneController: ConversationPaneLayoutController;
  phoneSinglePane: boolean;
  primarySessionName: string;
  primarySessionId: string | null;
  onPromoteSession?: (sessionId: string) => void;
  sessions: readonly SessionListItemUi[];
  hostClient: HostClient;
  activeTheme: ThemeManifest;
  artifactThemeKey: string | number;
  artifactPreviewEnabled: boolean;
  readMedia: MediaPreviewReader | null;
  locale: 'zh-CN' | 'en';
  keyboardEnabled: boolean;
  activeProjectScopeKey?: string;
  onCreateConversation: (paneId: string) => Promise<string | null>;
  onOpenDocument?: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  fileBrowseRoot?: string | null;
};

export function WorkbenchConversationStage(props: WorkbenchConversationStageProps): ReactElement {
  if (props.conversationPanesEnabled && props.dockingEnabled) {
    return (
      <DockingWorkspace
        controller={props.docking}
        phoneSinglePane={props.phoneSinglePane}
        primaryPane={props.primaryPane}
        primarySessionId={props.primarySessionId}
        {...(props.onPromoteSession ? { onPromoteSession: props.onPromoteSession } : {})}
        keyboardEnabled={props.keyboardEnabled}
        {...(props.activeProjectScopeKey !== undefined
          ? { activeProjectScopeKey: props.activeProjectScopeKey }
          : {})}
        sessions={props.sessions}
        hostClient={props.hostClient}
        activeTheme={props.activeTheme}
        artifactThemeKey={props.artifactThemeKey}
        artifactPreviewEnabled={props.artifactPreviewEnabled}
        readMedia={props.readMedia}
        locale={props.locale}
        onCreateConversation={() => props.onCreateConversation('docking')}
        onOpenDocument={(doc, target) => {
          props.onOpenDocument?.(doc, target);
          if (props.dockingEnabled) props.docking.openToolView('doc');
        }}
        onOpenArtifactCanvas={(target) => {
          props.onOpenArtifactCanvas?.(target);
          if (props.dockingEnabled) props.docking.openToolView('canvas');
        }}
        {...(props.fileBrowseRoot !== undefined ? { fileBrowseRoot: props.fileBrowseRoot } : {})}
      />
    );
  }
  if (props.conversationPanesEnabled) {
    return (
      <ConversationPaneWorkspace
        controller={props.conversationPaneController}
        phoneSinglePane={props.phoneSinglePane}
        primaryPane={props.primaryPane}
        primarySessionName={props.primarySessionName}
        sessions={props.sessions}
        hostClient={props.hostClient}
        activeTheme={props.activeTheme}
        artifactThemeKey={props.artifactThemeKey}
        artifactPreviewEnabled={props.artifactPreviewEnabled}
        readMedia={props.readMedia}
        locale={props.locale}
        keyboardEnabled={props.keyboardEnabled}
        onCreateConversation={props.onCreateConversation}
        onOpenDocument={(doc, target) => {
          props.onOpenDocument?.(doc, target);
          if (props.dockingEnabled) props.docking.openToolView('doc');
        }}
        onOpenArtifactCanvas={(target) => {
          props.onOpenArtifactCanvas?.(target);
          if (props.dockingEnabled) props.docking.openToolView('canvas');
        }}
        {...(props.fileBrowseRoot !== undefined ? { fileBrowseRoot: props.fileBrowseRoot } : {})}
      />
    );
  }
  return <>{props.primaryPane}</>;
}
