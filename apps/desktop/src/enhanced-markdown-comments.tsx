import { useState, type ReactElement, type ReactNode } from 'react';
import { IconCommentAction } from './shell-icons';
import { LineCopyButton } from './line-copy-button';
import type { LineCommentItem } from './enhanced-markdown-types.js';

/**
 * Line Comment Row Container with Hover Icon & Inline Popover (Matching Antigravity Reference)
 */
export function LineCommentWrapper({
  as = 'div',
  lineId,
  lineText,
  comments = [],
  onAddComment,
  onEditComment,
  onDeleteComment,
  onCommentLine,
  children,
  className = '',
}: {
  as?: 'div' | 'li' | undefined;
  lineId: string;
  lineText?: string | null | undefined;
  comments?: LineCommentItem[] | undefined;
  onAddComment?:
    ((comment: { lineId: string; lineText: string; commentText: string }) => void) | undefined;
  onEditComment?: ((id: string, commentText: string) => void) | undefined;
  onDeleteComment?: ((id: string) => void) | undefined;
  onCommentLine?: ((lineContent: string) => void) | undefined;
  children: ReactNode;
  className?: string | undefined;
}): ReactElement {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverMode, setPopoverMode] = useState<'create' | 'view' | 'edit'>('create');
  const [inputText, setInputText] = useState('');
  const [editText, setEditText] = useState('');

  const validText = typeof lineText === 'string' ? lineText.trim() : '';
  const existingComment = comments.find((c) => c.lineId === lineId);
  const hasComment = Boolean(existingComment);

  function handleTogglePopover(): void {
    if (popoverOpen) {
      setPopoverOpen(false);
      return;
    }
    if (hasComment) {
      setPopoverMode('view');
    } else {
      setPopoverMode('create');
      setInputText('');
    }
    setPopoverOpen(true);
  }

  function handleCreateSubmit(): void {
    const textToSave = inputText.trim();
    if (!textToSave || !validText) return;

    onAddComment?.({
      lineId,
      lineText: validText,
      commentText: textToSave,
    });
    onCommentLine?.(`[${validText}] "${textToSave}"`);
    setPopoverOpen(false);
    setInputText('');
  }

  function handleEditSubmit(): void {
    const textToSave = editText.trim();
    if (!textToSave || !existingComment) return;

    onEditComment?.(existingComment.id, textToSave);
    setPopoverMode('view');
  }

  function handleDelete(): void {
    if (!existingComment) return;
    onDeleteComment?.(existingComment.id);
    setPopoverOpen(false);
  }

  const WrapperTag = as;

  return (
    <WrapperTag data-line-id={lineId}
      className={[
        'enhanced-line-wrapper',
        'has-hover-highlight',
        hasComment ? 'has-comment' : '',
        popoverOpen ? 'popover-open' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="line-main-content">{children}</div><LineCopyButton />

      <button
        type="button"
        className={`line-comment-btn ${hasComment ? 'has-comment' : ''}`}
        title={hasComment ? 'View comment' : 'Add comment'}
        aria-label={hasComment ? 'View comment' : 'Add comment'}
        onClick={(e) => {
          e.stopPropagation();
          handleTogglePopover();
        }}
      >
        <IconCommentAction width={14} height={14} />
      </button>

      {popoverOpen ? (
        <div className="line-comment-popover-anchor">
          <div className="line-comment-popover">
            {popoverMode === 'create' ? (
              <>
                <textarea
                  className="line-comment-input"
                  placeholder="Leave a comment"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  autoFocus
                />
                <div className="line-comment-popover-actions">
                  <button
                    type="button"
                    className="popover-btn-cancel"
                    onClick={() => setPopoverOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="popover-btn-submit"
                    disabled={!inputText.trim()}
                    onClick={handleCreateSubmit}
                  >
                    Add Comment
                  </button>
                </div>
              </>
            ) : popoverMode === 'edit' ? (
              <>
                <textarea
                  className="line-comment-input"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                />
                <div className="line-comment-popover-actions">
                  <button
                    type="button"
                    className="popover-btn-cancel"
                    onClick={() => setPopoverMode('view')}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="popover-btn-submit"
                    disabled={!editText.trim()}
                    onClick={handleEditSubmit}
                  >
                    Save
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="line-comment-body">{existingComment?.commentText}</div>
                <div className="line-comment-popover-actions">
                  <button type="button" className="popover-btn-delete" onClick={handleDelete}>
                    Delete
                  </button>
                  <button
                    type="button"
                    className="popover-btn-edit"
                    onClick={() => {
                      setEditText(existingComment?.commentText || '');
                      setPopoverMode('edit');
                    }}
                  >
                    Edit Comment
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </WrapperTag>
  );
}
