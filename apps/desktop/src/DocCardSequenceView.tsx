/**
 * Sequential Doc Cards viewer. Reads CardStore live by sequenceId.
 * Prev/next never write transcript or model context.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { FlashcardRecord, HostResponse, ReviewRating } from '@piwin/contracts';
import type { DocCardSequenceView as DocCardSequencePointer } from '@piwin/contracts';
import { buildDocCardSurface } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';

export type DocCardSequenceRequest = (command: {
  type: 'flashcards/list' | 'flashcards/rate' | 'doccards/open-source';
  sequenceId?: string;
  cardId?: string;
  rating?: ReviewRating;
}) => Promise<HostResponse>;

export type DocCardSequenceViewProps = {
  sequence: DocCardSequencePointer;
  request: DocCardSequenceRequest;
};

export function sortSequenceCards(
  cards: FlashcardRecord[],
  snapshotIds: string[],
): FlashcardRecord[] {
  const allowed = new Set(snapshotIds);
  return cards
    .filter((card) => allowed.has(card.id))
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
}

export function DocCardSequenceView(props: DocCardSequenceViewProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const [cards, setCards] = useState<FlashcardRecord[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(async () => {
    const response = await props.request({
      type: 'flashcards/list',
      sequenceId: props.sequence.sequenceId,
    });
    if (!response.success) {
      setCards([]);
      return;
    }
    const records = ((response.data as { cards?: FlashcardRecord[] })?.cards ?? []).filter(
      (card) => typeof card.id === 'string',
    );
    setCards(sortSequenceCards(records, props.sequence.cardIds));
    setIndex(0);
    setRevealed(false);
  }, [props, props.sequence.cardIds, props.sequence.sequenceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const surface = useMemo(
    () =>
      buildDocCardSurface({
        workspaceName: props.sequence.workspaceName,
        cards,
      }),
    [cards, props.sequence.workspaceName],
  );
  const current = surface.cards[index];
  const atStart = index <= 0;
  const atEnd = index >= surface.cards.length - 1;

  const go = useCallback((nextIndex: number) => {
    setIndex(nextIndex);
    setRevealed(false);
  }, []);

  const rate = useCallback(
    async (rating: ReviewRating) => {
      if (!current) return;
      await props.request({ type: 'flashcards/rate', cardId: current.id, rating });
    },
    [current, props],
  );

  const openSource = useCallback(async () => {
    if (!current) return;
    await props.request({ type: 'doccards/open-source', cardId: current.id });
  }, [current, props]);

  if (surface.cards.length === 0) {
    return (
      <section className="doc-card-surface" data-testid="doc-card-sequence-empty" data-slot="empty">
        <p>{t('No cards left in this sequence', '这个序列里已经没有卡片了')}</p>
      </section>
    );
  }

  return (
    <section className="doc-card-surface" data-testid="doc-card-sequence" data-slot="surface">
      <header className="doc-card-surface-meta" data-slot="progress">
        {surface.workspaceName} · {current?.position}/{current?.total}
      </header>
      <article className="doc-card-surface-face" data-slot="card" data-card-id={current?.id}>
        <div className="doc-card-sequence-front" data-testid="doc-card-sequence-front" data-slot="front">
          {current?.front}
        </div>
        {revealed ? (
          <div className="doc-card-sequence-back" data-testid="doc-card-sequence-back" data-slot="back">
            {current?.back}
          </div>
        ) : (
          <Button data-testid="doc-card-sequence-reveal" onClick={() => setRevealed(true)}>
            {t('Reveal', '显示答案')}
          </Button>
        )}
      </article>
      <footer className="doc-card-sequence-nav" data-slot="actions">
        <Button
          data-testid="doc-card-sequence-prev"
          disabled={atStart}
          onClick={() => go(index - 1)}
        >
          {t('Previous', '上一张')}
        </Button>
        <Button data-testid="doc-card-sequence-next" disabled={atEnd} onClick={() => go(index + 1)}>
          {t('Next', '下一张')}
        </Button>
        {revealed ? (
          <>
            <Button onClick={() => void rate('again')}>{t('Again', '忘了')}</Button>
            <Button onClick={() => void rate('hard')}>{t('Hard', '较难')}</Button>
            <Button onClick={() => void rate('good')}>{t('Good', '记住了')}</Button>
            <Button onClick={() => void rate('easy')}>{t('Easy', '简单')}</Button>
          </>
        ) : null}
        {current?.canOpenSource ? (
          <Button data-testid="doc-card-sequence-source" onClick={() => void openSource()}>
            {current.sourceLabel ?? t('Open source', '打开源文件')}
          </Button>
        ) : null}
      </footer>
    </section>
  );
}
