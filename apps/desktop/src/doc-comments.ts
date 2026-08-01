import type { LineCommentItem } from './EnhancedMarkdownView';

/**
 * Serialize desktop line comments into prompt text for session/prompt.
 * Desktop-only; host never sees structured comment objects.
 */
export function formatDocCommentsForPrompt(
  docTitle: string,
  comments: readonly LineCommentItem[],
): string {
  if (comments.length === 0) return '';
  const header = `## Comments on \`${docTitle}\` (${comments.length})`;
  const body = comments
    .map((comment, index) => {
      const quote = comment.lineText.trim().slice(0, 200);
      const note = comment.commentText.trim();
      return `${index + 1}. > ${quote}\n   ${note}`;
    })
    .join('\n\n');
  return `${header}\n\n${body}`;
}

export function mergeComposerWithDocComments(
  composerText: string,
  docTitle: string,
  comments: readonly LineCommentItem[],
): string {
  const block = formatDocCommentsForPrompt(docTitle, comments);
  const text = composerText.trim();
  if (!block) return text;
  if (!text) return block;
  return `${block}\n\n${text}`;
}
