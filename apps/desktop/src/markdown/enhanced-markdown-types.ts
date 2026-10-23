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
