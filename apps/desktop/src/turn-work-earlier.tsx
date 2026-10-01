import { useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { TranscriptTurn } from './transcript-turns.js';

/** Seek a bounded window at the missing head; never inflate the resident transcript. */
export function TurnWorkEarlier(props: {
  turn: TranscriptTurn;
  locale: 'zh-CN' | 'en';
  onLoad: (messageId: string) => Promise<void> | void;
}): ReactElement | null {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const summary = props.turn.summary;
  const firstIndex = props.turn.items[0]?.message.transcriptIndex;
  if (summary === undefined || firstIndex === undefined || firstIndex <= summary.startIndex)
    return null;
  const missing = firstIndex - summary.startIndex;
  const zh = props.locale === 'zh-CN';
  return (
    <Button
      className="turn-work-segment-earlier"
      variant="ghost"
      size="compact"
      data-testid="turn-work-earlier"
      disabled={loading}
      onClick={() => {
        setLoading(true);
        setFailed(false);
        void (async () => {
          try {
            await props.onLoad(summary.firstMessageId);
          } catch {
            setFailed(true);
          } finally {
            setLoading(false);
          }
        })();
      }}
    >
      {failed
        ? zh
          ? '载入失败 · 点击重试'
          : 'Load failed · Retry'
        : loading
          ? zh
            ? '载入中…'
            : 'Loading…'
          : zh
            ? `更早的 ${missing} 条消息未载入 · 载入`
            : `${missing} earlier messages not loaded · Load`}
    </Button>
  );
}
