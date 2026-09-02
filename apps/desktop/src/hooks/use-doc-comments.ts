/**
 * Line comments collected on the open document, keyed by document so that
 * switching documents parks its draft comments instead of losing them.
 * Sending merges them into the composer text and clears only that document.
 */
import { useCallback, useState } from 'react';
import type { ActiveDocument } from '../active-document';
import type { LineCommentItem } from '../EnhancedMarkdownView';
import { mergeComposerWithDocComments } from '../doc-comments';
import { isReservedComposerSlashCommand } from '../slash/slash-parse.js';

export type UseDocCommentsArgs = {
  activeDocument: ActiveDocument | null;
  composer: string;
  send: (text: string) => Promise<void>;
};

export type DocCommentsActions = {
  activeComments: LineCommentItem[];
  addDocComment: (comment: { lineId: string; lineText: string; commentText: string }) => void;
  editDocComment: (id: string, nextText: string) => void;
  deleteDocComment: (id: string) => void;
  clearDocComments: () => void;
  sendWithComments: (text?: string) => Promise<void>;
};

export function documentCommentKey(document: ActiveDocument | null): string {
  return document?.filePath || document?.title || 'default';
}

export function useDocComments(args: UseDocCommentsArgs): DocCommentsActions {
  const { activeDocument, composer, send } = args;
  const [docComments, setDocComments] = useState<Record<string, LineCommentItem[]>>({});

  const activeDocKey = documentCommentKey(activeDocument);
  const activeComments = docComments[activeDocKey] || [];

  const addDocComment = useCallback(
    (comment: { lineId: string; lineText: string; commentText: string }) => {
      const newCommentItem: LineCommentItem = {
        id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        lineId: comment.lineId,
        lineText: comment.lineText,
        commentText: comment.commentText,
      };

      setDocComments((prev) => ({
        ...prev,
        [activeDocKey]: [...(prev[activeDocKey] || []), newCommentItem],
      }));

      // Automatically focus composer after creating a comment
      setTimeout(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="composer-input"]',
        );
        if (textarea) {
          textarea.focus();
        }
      }, 50);
    },
    [activeDocKey],
  );

  const editDocComment = useCallback(
    (id: string, nextText: string) => {
      setDocComments((prev) => ({
        ...prev,
        [activeDocKey]: (prev[activeDocKey] || []).map((comment) =>
          comment.id === id ? { ...comment, commentText: nextText } : comment,
        ),
      }));
    },
    [activeDocKey],
  );

  const deleteDocComment = useCallback(
    (id: string) => {
      setDocComments((prev) => ({
        ...prev,
        [activeDocKey]: (prev[activeDocKey] || []).filter((comment) => comment.id !== id),
      }));
    },
    [activeDocKey],
  );

  const clearDocComments = useCallback(() => {
    setDocComments((prev) => ({ ...prev, [activeDocKey]: [] }));
  }, [activeDocKey]);

  const sendWithComments = useCallback(
    async (overrideText?: string) => {
      const base = overrideText ?? composer;
      if (isReservedComposerSlashCommand(base)) {
        await send(base);
        return;
      }
      const docTitle = activeDocument?.title || 'Document';
      const comments = activeComments;
      const text =
        comments.length > 0 ? mergeComposerWithDocComments(base, docTitle, comments) : base;
      if (comments.length > 0) {
        setDocComments((prev) => ({ ...prev, [activeDocKey]: [] }));
      }
      await send(text);
    },
    [activeDocument?.title, activeComments, composer, activeDocKey, send],
  );

  return {
    activeComments,
    addDocComment,
    editDocComment,
    deleteDocComment,
    clearDocComments,
    sendWithComments,
  };
}
