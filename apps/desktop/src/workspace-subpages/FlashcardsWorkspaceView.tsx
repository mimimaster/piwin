import type { ReactElement } from 'react';
import type { DesktopLocale } from '../desktop-locale.js';
import type { HostCommand, HostPush, HostResponse } from '@piwin/contracts';
import type { HostRequestOptions } from '@piwin/host-client';
import { KnowledgeWorkspaceView } from './KnowledgeWorkspaceView.js';

export type FlashcardsHomeCommand = HostCommand;

export type FlashcardsRequester = (
  command: HostCommand,
  options?: HostRequestOptions,
) => Promise<HostResponse>;

export type FlashcardsWorkspaceViewProps = {
  locale?: DesktopLocale;
  onClose: () => void;
  request: FlashcardsRequester;
  projectPath?: string | null | undefined;
  onConfigureEmbedding?: (() => void) | undefined;
  subscribePush?: ((listener: (push: HostPush) => void) => () => void) | undefined;
  subscribeConnected?: ((listener: (connected: boolean) => void) => () => void) | undefined;
  hasStudyCapability?: (() => boolean) | undefined;
  entry?: 'gallery' | 'produce';
  /** With `entry: 'produce'`, starts the produce flow on this folder. */
  initialFolderPath?: string | undefined;
  onOpenSession?: ((sessionId: string) => void) | undefined;
  knowledgeSupported?: boolean;
};

/**
 * Flashcards workspace view adapter.
 * Unified into Knowledge Center (Option A); delegates to `KnowledgeWorkspaceView` with initialTab.
 */
export function FlashcardsWorkspaceView(props: FlashcardsWorkspaceViewProps): ReactElement {
  return (
    <KnowledgeWorkspaceView
      locale={props.locale === 'en' ? 'en' : 'zh-CN'}
      onClose={props.onClose}
      request={props.request}
      initialTab={props.entry === 'produce' ? 'documents' : 'flashcards'}
      initialFolderPath={props.initialFolderPath}
      projectPath={props.projectPath}
      subscribePush={props.subscribePush}
      subscribeConnected={props.subscribeConnected}
      hasStudyCapability={props.hasStudyCapability}
      knowledgeSupported={props.knowledgeSupported ?? true}
      onConfigureEmbedding={props.onConfigureEmbedding}
      onOpenSession={props.onOpenSession}
      onUseInChat={() => undefined}
      onSendToChat={() => undefined}
      onOpenCitation={() => undefined}
    />
  );
}

export type { FlashcardsRequester as FlashcardsWorkspaceRequester };
