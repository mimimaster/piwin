export type LineCommentItem = {
  id: string;
  lineId: string;
  lineText: string;
  commentText: string;
};

export type EnhancedMarkdownViewProps = {
  text: string;
  docTitle?: string | undefined;
  filePath?: string | undefined;
  /**
   * Project root for relative chips. Without it a chip keeps the raw relative
   * text, so Reveal / Save As can never resolve an absolute path.
   */
  projectPath?: string | undefined;
  onOpenFile?: ((filePath: string) => void) | undefined;
  comments?: LineCommentItem[] | undefined;
  onAddComment?:
    ((comment: { lineId: string; lineText: string; commentText: string }) => void) | undefined;
  onEditComment?: ((id: string, commentText: string) => void) | undefined;
  onDeleteComment?: ((id: string) => void) | undefined;
  onCommentLine?: ((lineContent: string) => void) | undefined;
};

export type DiffActionType = 'MODIFY' | 'NEW' | 'DELETE' | 'RENAME';

export type EnhancedBlock =
  | {
      type: 'heading';
      level: number;
      text: string;
      action?: DiffActionType | undefined;
      ext?: string | undefined;
      path?: string | undefined;
    }
  | {
      type: 'diff-header';
      action: DiffActionType;
      ext?: string | undefined;
      path: string;
      description?: string | undefined;
    }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: EnhancedListItem[] }
  | { type: 'ordered-list'; items: EnhancedListItem[] }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; language: string; source: string }
  | { type: 'details'; summary: string; content: string }
  | { type: 'callout'; kind: 'note' | 'tip' | 'important' | 'warning' | 'caution'; text: string }
  | { type: 'hr' }
  | {
      type: 'table';
      headers: string[];
      alignments: ('left' | 'center' | 'right' | 'default')[];
      rows: string[][];
    };

export type EnhancedListItem = {
  text: string;
  checked?: boolean | undefined;
  subItems?: string[] | undefined;
};
