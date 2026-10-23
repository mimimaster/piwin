/**
 * "Comment" button beside a text selection inside the Canvas sandbox.
 *
 * Same chrome as the transcript selection toolbar; the click quotes the text
 * into the Composer through the shared add-to-chat path. The selection itself
 * comes from the untrusted frame, so nothing happens until the user clicks.
 */
import type { ReactElement } from 'react';
import { Popover } from '@piwin/ui-kit';
import { useDesktopContextMenu } from '../context-menu/index.js';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import type { ArtifactTextSelection } from './artifact-canvas-selection.js';
import { addSelectionToChat } from '../selection/selection-add-to-chat.js';
import { IconCommentAction } from '../tool-cards/shell-icons.js';

export function ArtifactCanvasSelectionComment(props: {
  selection: ArtifactTextSelection;
  locale: DesktopLocale;
  onDone: () => void;
}): ReactElement | null {
  const contextMenu = useDesktopContextMenu();
  if (!contextMenu) return null;
  const label = props.locale === 'zh-CN' ? '评论' : 'Comment';

  const handleComment = (): void => {
    if (addSelectionToChat(contextMenu, props.selection.text)) {
      props.selection.clear();
    }
    props.onDone();
  };

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) props.onDone();
      }}
      virtualAnchor={props.selection.anchor}
      side="top"
      align="start"
      contentClassName="transcript-selection-toolbar"
      testId="artifact-canvas-selection-toolbar"
      label="Selection actions"
      autoFocus={false}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      <div className="selection-toolbar-inner">
        <button
          type="button"
          className="selection-toolbar-btn"
          data-testid="artifact-canvas-selection-comment"
          onClick={handleComment}
        >
          <span className="selection-toolbar-btn-icon" aria-hidden="true">
            <IconCommentAction width={13} height={13} />
          </span>
          <span>{label}</span>
        </button>
      </div>
    </Popover>
  );
}
