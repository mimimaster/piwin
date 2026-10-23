import { useState, type ReactElement } from 'react';

const QUOTE_PREVIEW_MAX_CHARS = 120;

export type SelectionCommentFormProps = {
  quote: string;
  isZh: boolean;
  onSubmit: (commentText: string) => void;
  onCancel: () => void;
};

function quotePreview(quote: string): string {
  const collapsed = quote.replace(/\s+/g, ' ').trim();
  return collapsed.length <= QUOTE_PREVIEW_MAX_CHARS
    ? collapsed
    : `${collapsed.slice(0, QUOTE_PREVIEW_MAX_CHARS - 1)}…`;
}

/** Inline composer shown inside the selection toolbar after "Comment". */
export function SelectionCommentForm(props: SelectionCommentFormProps): ReactElement {
  const [draft, setDraft] = useState('');
  const commentText = draft.trim();
  const submit = (): void => {
    if (commentText) props.onSubmit(commentText);
  };

  return (
    <div className="selection-toolbar-form" data-testid="selection-toolbar-comment-form">
      <div className="selection-toolbar-quote">{quotePreview(props.quote)}</div>
      <textarea
        className="selection-toolbar-input"
        data-testid="selection-toolbar-comment-input"
        placeholder={props.isZh ? '写下评论…' : 'Leave a comment'}
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="selection-toolbar-form-actions">
        <button type="button" className="selection-toolbar-btn" onClick={props.onCancel}>
          {props.isZh ? '取消' : 'Cancel'}
        </button>
        <button
          type="button"
          className="selection-toolbar-btn selection-toolbar-btn-primary"
          data-testid="selection-toolbar-comment-submit"
          disabled={!commentText}
          onClick={submit}
        >
          {props.isZh ? '添加评论' : 'Add Comment'}
        </button>
      </div>
    </div>
  );
}
