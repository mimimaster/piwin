/**
 * Reply Writer chip: "rewriting…" while Host runs the writer, then
 * "由 X 整理" — a toggle between the rewrite and the worker draft when the
 * draft was kept. Conversation shows it on the turn identity header; project
 * sessions have no such header, so it sits in the reply's colophon.
 */
import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { ChatMessageUi } from './chat-reducer';
import { toggleReplyWriterSource, useReplyWriterSourceShown } from './reply-writer-source-view';

export type ReplyWriterChipSource = Pick<ChatMessageUi, 'id' | 'replyWriter' | 'replyWriterPending'>;

export function ReplyWriterChip(props: {
  source: ReplyWriterChipSource;
  locale: 'zh-CN' | 'en';
}): ReactElement | null {
  const { source } = props;
  const showingSource = useReplyWriterSourceShown(source.id);
  const isEnglish = props.locale === 'en';
  if (source.replyWriterPending === true) {
    return (
      <span
        className="conversation-reply-writer-chip is-pending"
        data-testid="conversation-reply-writer-chip"
      >
        {isEnglish ? 'Rewriting reply…' : '正在整理输出…'}
      </span>
    );
  }
  const attribution = source.replyWriter;
  if (!attribution) return null;
  const writerModelId = attribution.model.modelId;
  const rewrittenLabel = isEnglish ? `Rewritten by ${writerModelId}` : `由 ${writerModelId} 整理`;
  if (!attribution.sourceText) {
    return (
      <span
        className="conversation-reply-writer-chip"
        data-testid="conversation-reply-writer-chip"
        title={writerModelId}
      >
        {rewrittenLabel}
      </span>
    );
  }
  return (
    <Button
      variant="ghost"
      size="compact"
      className={`conversation-reply-writer-chip is-toggle${showingSource ? ' is-source' : ''}`}
      data-testid="conversation-reply-writer-chip"
      aria-pressed={showingSource}
      title={
        showingSource
          ? isEnglish
            ? 'Show the rewritten reply'
            : '切回整理后的回复'
          : isEnglish
            ? 'Show the original draft'
            : '查看委托前的原稿'
      }
      onClick={() => toggleReplyWriterSource(source.id)}
    >
      {showingSource ? (isEnglish ? 'Original draft' : '委托前原稿') : rewrittenLabel}
    </Button>
  );
}

/** Body text for a row: the worker draft while its toggle is on. */
export function useReplyWriterDisplayText(message: ChatMessageUi): string {
  const showingSource = useReplyWriterSourceShown(message.id);
  return showingSource && message.replyWriter?.sourceText
    ? message.replyWriter.sourceText
    : message.text;
}
