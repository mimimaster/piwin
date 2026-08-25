import type { ReactElement } from 'react';
import type { HostResponse } from '@piwin/contracts';
import type { DesktopLocale } from './desktop-locale';
import {
  FlashcardsWorkspaceView,
  ImagesWorkspaceView,
  VideosWorkspaceView,
} from './workspace-subpages';
import type { FlashcardsWorkspaceCommand } from './workspace-subpages/flashcards/use-flashcards-workspace';

export type WorkbenchSubpageStageProps = {
  activeSubPage: 'chat' | 'images' | 'videos' | 'flashcards' | null;
  locale: DesktopLocale;
  onClose: () => void;
  onSendToChat: (text: string) => void;
  requestFlashcards: (command: FlashcardsWorkspaceCommand) => Promise<HostResponse>;
};

/**
 * Fullscreen takeover stage for media studios and flashcards workspace.
 * Renders as a top-level overlay covering the workbench shell and sidebar.
 */
export function WorkbenchSubpageStage(props: WorkbenchSubpageStageProps): ReactElement | null {
  if (!props.activeSubPage || props.activeSubPage === 'chat') {
    return null;
  }

  if (props.activeSubPage === 'images') {
    return (
      <ImagesWorkspaceView
        locale={props.locale}
        onClose={props.onClose}
        onSendToChat={props.onSendToChat}
      />
    );
  }

  if (props.activeSubPage === 'videos') {
    return (
      <VideosWorkspaceView
        locale={props.locale}
        onClose={props.onClose}
        onSendToChat={props.onSendToChat}
      />
    );
  }

  if (props.activeSubPage === 'flashcards') {
    return (
      <FlashcardsWorkspaceView
        locale={props.locale}
        onClose={props.onClose}
        request={props.requestFlashcards}
        onSendToChat={props.onSendToChat}
      />
    );
  }

  return null;
}
