import type { ReactElement } from 'react';
import type {
  HostCommand,
  HostPush,
  HostResponse,
  KnowledgeCitation,
  MediaLibraryItem,
} from '@piwin/contracts';
import type { HostRequestOptions } from '@piwin/host-client';
import type { DesktopLocale } from './desktop-locale';
import {
  KnowledgeWorkspaceView,
  LibraryWorkspaceView,
  MarketplaceWorkspaceView,
} from './workspace-subpages/index.js';

export type WorkbenchSubpageStageProps = {
  activeSubPage:
    | 'chat'
    | 'library'
    | 'images'
    | 'videos'
    | 'flashcards'
    | 'knowledge'
    | 'marketplace'
    | null;
  locale: DesktopLocale;
  onClose: () => void;
  request: (command: HostCommand) => Promise<HostResponse>;
  requestFlashcards: (command: HostCommand, options?: HostRequestOptions) => Promise<HostResponse>;
  refreshToken?: number;
  projectPath?: string | null | undefined;
  sessionId?: string | null | undefined;
  onConfigureEmbedding?: (() => void) | undefined;
  subscribePush?: (listener: (push: HostPush) => void) => () => void;
  subscribeKnowledgePush?: (listener: (push: HostPush) => void) => () => void;
  subscribeConnected?: (listener: (connected: boolean) => void) => () => void;
  hasStudyCapability?: () => boolean;
  flashcardsEntry?: 'gallery' | 'produce';
  flashcardsFolderPath?: string | undefined;
  onOpenSession?: ((sessionId: string) => void) | undefined;
  onRemixToComposer?: (input: { text: string; item?: MediaLibraryItem }) => void;
  knowledgeSupported?: boolean;
  onOpenIngest?: (folderPath: string) => void;
  onUseKnowledgeInChat?: (baseId: string) => void;
  onOpenKnowledgeCitation?: (citation: KnowledgeCitation) => void;
};

/**
 * Library, Flashcards, and Knowledge jump to a full-window page.
 * Sidebar, titleband, and chat stage hide; back returns to the session.
 */
export function WorkbenchSubpageStage(props: WorkbenchSubpageStageProps): ReactElement | null {
  if (!props.activeSubPage || props.activeSubPage === 'chat') {
    return null;
  }

  if (
    props.activeSubPage === 'library' ||
    props.activeSubPage === 'images' ||
    props.activeSubPage === 'videos'
  ) {
    return (
      <LibraryWorkspaceView
        onClose={props.onClose}
        request={props.request}
        locale={props.locale}
        initialKind={props.activeSubPage === 'videos' ? 'video' : 'image'}
        {...(props.subscribeConnected !== undefined
          ? { subscribeConnected: props.subscribeConnected }
          : {})}
        {...(props.refreshToken !== undefined ? { refreshToken: props.refreshToken } : {})}
        {...(props.onRemixToComposer !== undefined
          ? { onRemixToComposer: props.onRemixToComposer }
          : {})}
      />
    );
  }

  if (props.activeSubPage === 'flashcards' || props.activeSubPage === 'knowledge') {
    const initialTab =
      props.activeSubPage === 'flashcards' && props.flashcardsEntry !== 'produce'
        ? 'flashcards'
        : props.flashcardsFolderPath || props.flashcardsEntry === 'produce'
          ? 'documents'
          : 'wiki';
    return (
      <KnowledgeWorkspaceView
        key={props.flashcardsFolderPath ?? props.activeSubPage}
        locale={props.locale === 'en' ? 'en' : 'zh-CN'}
        onClose={props.onClose}
        request={props.request}
        studyRequest={props.requestFlashcards}
        initialTab={initialTab}
        initialFolderPath={props.flashcardsFolderPath}
        projectPath={props.projectPath}
        subscribePush={props.subscribePush}
        subscribeKnowledgePush={props.subscribeKnowledgePush}
        subscribeConnected={props.subscribeConnected}
        hasStudyCapability={props.hasStudyCapability}
        knowledgeSupported={props.knowledgeSupported === true}
        onOpenIngest={(folderPath) => props.onOpenIngest?.(folderPath)}
        onUseInChat={(baseId) => props.onUseKnowledgeInChat?.(baseId)}
        onSendToChat={(text) => props.onRemixToComposer?.({ text })}
        onOpenCitation={(citation) => props.onOpenKnowledgeCitation?.(citation)}
        onConfigureEmbedding={props.onConfigureEmbedding}
        onOpenSession={props.onOpenSession}
      />
    );
  }

  if (props.activeSubPage === 'marketplace') {
    return (
      <MarketplaceWorkspaceView
        locale={props.locale}
        onClose={props.onClose}
        request={props.request}
        projectPath={props.projectPath}
        sessionId={props.sessionId}
      />
    );
  }

  return null;
}
