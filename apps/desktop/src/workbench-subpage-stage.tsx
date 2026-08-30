import type { ReactElement } from 'react';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import type { DesktopLocale } from './desktop-locale';
import { FlashcardsWorkspaceView, LibraryWorkspaceView } from './workspace-subpages';
import type { FlashcardsHomeCommand } from './workspace-subpages/FlashcardsWorkspaceView';

export type WorkbenchSubpageStageProps = {
  activeSubPage: 'chat' | 'library' | 'images' | 'videos' | 'flashcards' | null;
  locale: DesktopLocale;
  onClose: () => void;
  request: (command: HostCommand) => Promise<HostResponse>;
  requestFlashcards: (command: FlashcardsHomeCommand) => Promise<HostResponse>;
  refreshToken?: number;
  projectPath?: string | null | undefined;
  onConfigureEmbedding?: (() => void) | undefined;
};

/**
 * Library and Flashcards jump to a full-window page.
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
        {...(props.refreshToken !== undefined ? { refreshToken: props.refreshToken } : {})}
      />
    );
  }

  if (props.activeSubPage === 'flashcards') {
    return (
      <FlashcardsWorkspaceView
        locale={props.locale}
        onClose={props.onClose}
        request={props.requestFlashcards}
        projectPath={props.projectPath}
        {...(props.onConfigureEmbedding
          ? { onConfigureEmbedding: props.onConfigureEmbedding }
          : {})}
      />
    );
  }

  return null;
}
