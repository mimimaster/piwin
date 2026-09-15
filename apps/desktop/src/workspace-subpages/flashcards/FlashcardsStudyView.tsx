import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Notice, Spinner } from '@piwin/ui-kit';
import type {
  FlashcardCreateInput,
  FlashcardStudyCatalogPage,
  HostPush,
} from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useFlashcardsWorkspace } from './use-flashcards-workspace';
import { CreateCardDialog } from './workspace-dialogs';
import { FlashcardsDeckManager } from './flashcards-deck-manager';
import { groupFlashcardTiles, tileCards, tileMatchesQuery } from './group-flashcard-tiles';
import { FlashcardStudyRoute } from './study/FlashcardStudyRoute';
import {
  captureStudyReturnContext,
  clearStudyReturnContext,
  saveStudyReturnContext,
  type FlashcardStudyReturnContext,
} from './study/study-return-context';
import {
  createStudyEntry,
  scheduledScopeForDeck,
  studyScopeForTile,
} from './study/study-entry';
import type { FlashcardStudyEntry } from './study/use-flashcard-study';
import type { FlashcardStudyPorts, FlashcardStudyRequest } from './study/study-session';
import { TactileStudyStage } from './TactileStudyStage';
import { FlashcardsLibraryStage } from './FlashcardsLibraryStage';

export type FlashcardsStudyViewProps = {
  locale?: DesktopLocale;
  request: FlashcardStudyRequest;
  subscribePush?: ((listener: (push: HostPush) => void) => () => void) | undefined;
  subscribeConnected?: ((listener: (connected: boolean) => void) => () => void) | undefined;
  hasStudyCapability?: (() => boolean) | undefined;
  onGoToDocuments?: (() => void) | undefined;
  onGoToWiki?: (() => void) | undefined;
  search?: string;
  onSearchChange?: (search: string) => void;
  initialMode?: 'library' | 'study' | 'decks';
};

export function FlashcardsStudyView(props: FlashcardsStudyViewProps): ReactElement {
  const { locale: contextLocale } = useDesktopLocale();
  const locale = props.locale ?? contextLocale ?? 'zh-CN';
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const ws = useFlashcardsWorkspace(props.request);
  const [selectedDeck, setSelectedDeck] = useState<string>('all');
  const [internalSearch, setInternalSearch] = useState('');
  const search = props.search ?? internalSearch;
  const setSearch = props.onSearchChange ?? setInternalSearch;

  const [createOpen, setCreateOpen] = useState(false);
  const [newDeck, setNewDeck] = useState('');
  const [newFront, setNewFront] = useState('');
  const [newBack, setNewBack] = useState('');
  const [study, setStudy] = useState<{
    entry: FlashcardStudyEntry;
    returnContext: FlashcardStudyReturnContext;
  } | null>(null);

  const [dueCount, setDueCount] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const [hostTooOld, setHostTooOld] = useState(false);
  const [cardMode, setCardMode] = useState<'library' | 'study' | 'decks'>(props.initialMode ?? 'library');
  const [deckScheduling, setDeckScheduling] = useState<
    Record<string, { due: number; fresh: number }>
  >({});

  const allGroupedTiles = useMemo(() => groupFlashcardTiles(ws.cards), [ws.cards]);

  const deckCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const card of ws.cards) {
      const d = card.deck || 'General';
      counts[d] = (counts[d] ?? 0) + 1;
    }
    return counts;
  }, [ws.cards]);

  const availableDecks = useMemo(() => Object.keys(deckCounts), [deckCounts]);

  const tiles = useMemo(() => {
    return allGroupedTiles.filter((tile) => {
      if (selectedDeck !== 'all') {
        const cards = tileCards(tile);
        const top = cards[0];
        if ((top?.deck || 'General') !== selectedDeck) {
          return false;
        }
      }
      return tileMatchesQuery(tile, search);
    });
  }, [allGroupedTiles, selectedDeck, search]);

  const restoreLibrary = useCallback((context: FlashcardStudyReturnContext) => {
    setSearch(context.search);
    setSelectedDeck(context.selectedDeck);
    setStudy(null);
    clearStudyReturnContext();
    requestAnimationFrame(() => {
      const main = document.getElementById('vault-main');
      if (main) main.scrollTop = context.scrollTop;
      if (context.focusTileId) {
        const tile = document.querySelector<HTMLElement>(
          `[data-testid="flashcard-tile-${context.focusTileId}"] .fcws-tile-face`,
        );
        tile?.focus();
      }
    });
  }, [setSearch]);

  const enterStudy = useCallback(
    (entry: FlashcardStudyEntry, focusTileId: string | null) => {
      if (props.hasStudyCapability && !props.hasStudyCapability()) {
        setHostTooOld(true);
        return;
      }
      setHostTooOld(false);
      const returnContext = captureStudyReturnContext({
        selectedDeck,
        search,
        scrollTop: document.getElementById('vault-main')?.scrollTop ?? 0,
        focusTileId,
      });
      saveStudyReturnContext(returnContext);
      setStudy({ entry, returnContext });
    },
    [props, search, selectedDeck],
  );

  const openScheduledOrPreview = useCallback(
    (deck: string, requireDeckCards: boolean) => {
      const hasCards = requireDeckCards
        ? ws.cards.some((card) => (card.deck || 'General') === deck)
        : ws.cards.length > 0;
      if (!hasCards) {
        setSelectedDeck(deck);
        setCardMode('study');
        return;
      }
      enterStudy(
        createStudyEntry({ mode: 'scheduled', scope: scheduledScopeForDeck(deck) }),
        null,
      );
    },
    [enterStudy, ws.cards],
  );

  const requestRef = useRef(props.request);
  requestRef.current = props.request;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const scope = scheduledScopeForDeck(selectedDeck);
      const response = await requestRef.current({
        type: 'flashcards/study/catalog',
        limit: 1,
        scopeFilter: scope,
      });
      if (cancelled) return;
      if (!response.success) {
        if (response.problem?.code === 'host-too-old') setHostTooOld(true);
        return;
      }
      const pageData = response.data as FlashcardStudyCatalogPage | undefined;
      setDueCount(pageData?.dueCount ?? 0);
      setNewCount(pageData?.newCount ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDeck, ws.cards.length]);

  useEffect(() => {
    if (cardMode !== 'decks' || availableDecks.length === 0) return undefined;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        availableDecks.map(async (deck) => {
          const response = await requestRef.current({
            type: 'flashcards/study/catalog',
            limit: 1,
            scopeFilter: { kind: 'deck', deck },
          });
          if (!response.success) return [deck, { due: 0, fresh: 0 }] as const;
          const page = response.data as FlashcardStudyCatalogPage | undefined;
          return [deck, { due: page?.dueCount ?? 0, fresh: page?.newCount ?? 0 }] as const;
        }),
      );
      if (cancelled) return;
      setDeckScheduling(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [cardMode, availableDecks, ws.cards.length]);

  useEffect(() => {
    if (cardMode !== 'study' || study !== null || ws.loading || ws.cards.length === 0) return;
    openScheduledOrPreview(selectedDeck, false);
  }, [cardMode, openScheduledOrPreview, selectedDeck, study, ws.cards.length, ws.loading]);

  const deleteTile = useCallback(
    async (tileId: string) => {
      const tile = allGroupedTiles.find((item) => item.id === tileId);
      if (!tile) return;
      const ids = tileCards(tile).map((card) => card.id);
      const ok = ids.length === 1 ? await ws.remove(ids[0] ?? '') : await ws.removeMany(ids);
      if (ok) {
        await ws.reload();
      }
    },
    [allGroupedTiles, ws],
  );

  const submitCreate = useCallback(async () => {
    if (newFront.trim() === '' || newBack.trim() === '') return;
    const input: FlashcardCreateInput = {
      model: 'basic',
      deck: newDeck.trim() !== '' ? newDeck.trim() : 'General',
      front: newFront.trim(),
      back: newBack.trim(),
    };
    const ok = await ws.create(input);
    if (ok) {
      setCreateOpen(false);
      setNewFront('');
      setNewBack('');
      await ws.reload();
    }
  }, [newDeck, newFront, newBack, ws]);

  const deckOptions = useMemo(() => {
    const options = ws.decks.map((deck) => ({ value: deck, label: deck }));
    return options.length > 0 ? options : [{ value: 'General', label: 'General' }];
  }, [ws.decks]);

  if (study) {
    const studyPorts: FlashcardStudyPorts = {
      request: props.request,
      ...(props.subscribePush ? { subscribePush: props.subscribePush } : {}),
      ...(props.subscribeConnected ? { subscribeConnected: props.subscribeConnected } : {}),
      ...(props.hasStudyCapability ? { hasStudyCapability: props.hasStudyCapability } : {}),
    };
    return (
      <FlashcardStudyRoute
        locale={locale}
        entry={study.entry}
        ports={studyPorts}
        onLeave={() => restoreLibrary(study.returnContext)}
      />
    );
  }

  const studySubnav = (
    <div className="study-subnav" data-testid="flashcards-study-subnav">
      <div className="subnav-modes">
        <button
          type="button"
          className={`subnav-btn${cardMode === 'study' ? ' active' : ''}`}
          id="mode-btn-study"
          onClick={() => openScheduledOrPreview(selectedDeck, false)}
          data-testid="flashcards-mode-study"
        >
          {t('Daily review', '每日复习')}
        </button>
        <button
          type="button"
          className={`subnav-btn${cardMode === 'decks' ? ' active' : ''}`}
          id="mode-btn-decks"
          onClick={() => setCardMode('decks')}
          data-testid="flashcards-mode-decks"
        >
          {t('Decks', '卡包管理')}
        </button>
        <button
          type="button"
          className={`subnav-btn${cardMode === 'library' ? ' active' : ''}`}
          id="mode-btn-library"
          onClick={() => setCardMode('library')}
          data-testid="flashcards-mode-library"
        >
          {t('Library', '卡片库')}
        </button>
      </div>
      <div className="subnav-stats">
        <span>
          {t('Streak: ', '连续复习：')}
          <strong className="is-zhu">0 {t('days', '天')}</strong>
        </span>
        <span>
          {t('Reviewed today: ', '今日已复习：')}
          <strong>0 {t('cards', '张')}</strong>
        </span>
        <button
          type="button"
          className="btn sm pri"
          onClick={() => setCreateOpen(true)}
          data-testid="flashcards-subnav-distill"
        >
          {t('+ Distill new cards', '+ 提炼新卡')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flashcards-study-stage" data-testid="flashcards-study-view">
      {studySubnav}

      {cardMode === 'study' && (
        <TactileStudyStage
          locale={locale}
          selectedDeck={selectedDeck}
          cards={ws.cards}
        />
      )}

      {cardMode === 'decks' && (
        <div className="flashcards-study-content" style={{ padding: '0 16px' }}>
          {ws.error !== null && (
            <Notice tone="error" testId="flashcards-error">
              {ws.error}
            </Notice>
          )}
          {ws.loading ? (
            <div className="vault-empty">
              <Spinner label={t('Loading decks…', '正在加载卡包…')} />
            </div>
          ) : (
            <FlashcardsDeckManager
              cards={ws.cards}
              locale={isZh ? 'zh-CN' : 'en'}
              deckCounts={deckScheduling}
              onStudyDeck={(deck) => openScheduledOrPreview(deck, true)}
              onOpenDeck={(deck) => {
                setSelectedDeck(deck);
                setCardMode('library');
              }}
              onCreateDeck={() => setCreateOpen(true)}
            />
          )}
        </div>
      )}

      {cardMode === 'library' && (
        <FlashcardsLibraryStage
          locale={locale}
          search={search}
          onSearchChange={setSearch}
          selectedDeck={selectedDeck}
          onSelectDeck={setSelectedDeck}
          availableDecks={availableDecks}
          deckCounts={deckCounts}
          totalCardsCount={ws.cards.length}
          dueCount={dueCount}
          newCount={newCount}
          hostTooOld={hostTooOld}
          error={ws.error}
          loading={ws.loading}
          tiles={tiles}
          onOpenTile={(tileId) => {
            const tile = tiles.find((item) => item.id === tileId);
            if (tile) enterStudy(createStudyEntry({ mode: 'sequence', scope: studyScopeForTile(tile) }), tileId);
          }}
          onDeleteTile={(tileId) => void deleteTile(tileId)}
          onStudyDue={() => enterStudy(createStudyEntry({ mode: 'scheduled', scope: scheduledScopeForDeck(selectedDeck) }), null)}
          onGoToDocuments={props.onGoToDocuments}
          onGoToWiki={props.onGoToWiki}
          onCreateCard={() => setCreateOpen(true)}
          onStartSampleStudy={() => setCardMode('study')}
        />
      )}

      <CreateCardDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        deckOptions={deckOptions}
        deck={newDeck === '' ? (deckOptions[0]?.value ?? 'General') : newDeck}
        onDeckChange={setNewDeck}
        front={newFront}
        onFrontChange={setNewFront}
        back={newBack}
        onBackChange={setNewBack}
        labels={{
          title: t('Create flashcard', '新建卡片'),
          deck: t('Group', '卡组'),
          front: t('Front', '正面'),
          frontPlaceholder: t('Question…', '问题…'),
          back: t('Back', '背面'),
          backPlaceholder: t('Answer…', '答案…'),
          cancel: t('Cancel', '取消'),
          save: t('Save', '保存'),
        }}
        onSave={() => void submitCreate()}
      />
    </div>
  );
}
