import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Button, Notice, Spinner } from '@piwin/ui-kit';
import type {
  FlashcardCreateInput,
  FlashcardStudyCatalogPage,
  HostCommand,
  HostPush,
  HostResponse,
} from '@piwin/contracts';
import type { HostRequestOptions } from '@piwin/host-client';
import { IconCards, IconPlus, IconSpark } from '../shell-icons';
import type { DesktopLocale } from '../desktop-locale';
import { StudioTopbar } from './studio/studio-chrome';
import {
  useFlashcardsWorkspace,
  type FlashcardsLibraryCommand,
} from './flashcards/use-flashcards-workspace';
import {
  useFlashcardsProduce,
  type FlashcardsProduceCommand,
} from './flashcards/use-flashcards-produce';
import { CreateCardDialog } from './flashcards/workspace-dialogs';
import { FlashcardGallery } from './flashcards/flashcard-gallery';
import {
  groupFlashcardTiles,
  tileCards,
  tileMatchesQuery,
} from './flashcards/group-flashcard-tiles';
import { ProduceStage } from './flashcards/produce-stage';
import { FlashcardStudyRoute } from './flashcards/study/FlashcardStudyRoute';
import { flashcardStudyCopy } from './flashcards/study/study-copy';
import {
  captureStudyReturnContext,
  clearStudyReturnContext,
  saveStudyReturnContext,
  type FlashcardStudyReturnContext,
} from './flashcards/study/study-return-context';
import {
  createStudyEntry,
  scheduledScopeForDeck,
  studyScopeForTile,
} from './flashcards/study/study-entry';
import type { FlashcardStudyEntry } from './flashcards/study/use-flashcard-study';
import type { FlashcardStudyPorts } from './flashcards/study/study-session';

export type FlashcardsHomeCommand = FlashcardsLibraryCommand | FlashcardsProduceCommand | HostCommand;
export type FlashcardsRequester = (
  command: HostCommand,
  options?: HostRequestOptions,
) => Promise<HostResponse>;

export type FlashcardsWorkspaceViewProps = {
  locale?: DesktopLocale;
  onClose: () => void;
  request: FlashcardsRequester;
  projectPath?: string | null | undefined;
  onConfigureEmbedding?: (() => void) | undefined;
  subscribePush?: (listener: (push: HostPush) => void) => () => void;
  subscribeConnected?: (listener: (connected: boolean) => void) => () => void;
  hasStudyCapability?: () => boolean;
  entry?: 'gallery' | 'produce';
  /** With `entry: 'produce'`, starts the produce flow on this folder. */
  initialFolderPath?: string | undefined;
  onOpenSession?: ((sessionId: string) => void) | undefined;
};

/** Flashcards home — tiled library; produce is a page jump into the folder loop. */
export function FlashcardsWorkspaceView(props: FlashcardsWorkspaceViewProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const locale = isZh ? 'zh-CN' : 'en';

  const [search, setSearch] = useState('');
  const [selectedDeck, setSelectedDeck] = useState<string>('all');
  const [page, setPage] = useState<'gallery' | 'produce'>(
    props.entry === 'produce' ? 'produce' : 'gallery',
  );
  const [study, setStudy] = useState<{
    entry: FlashcardStudyEntry;
    returnContext: FlashcardStudyReturnContext;
  } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newDeck, setNewDeck] = useState('');
  const [newFront, setNewFront] = useState('');
  const [newBack, setNewBack] = useState('');
  const [dueCount, setDueCount] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const [hostTooOld, setHostTooOld] = useState(false);

  const ws = useFlashcardsWorkspace(props.request);
  const produce = useFlashcardsProduce({
    request: props.request,
    projectPath: props.projectPath,
    locale,
    onCardsChanged: () => {
      void ws.reload();
    },
  });

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

  const producing = page === 'produce';
  const studying = study !== null;

  const { mountFolder } = produce;
  useEffect(() => {
    if (props.entry !== 'produce') return;
    setPage('produce');
    // Knowledge bases hand off a folder; it wins over the recent-folder default.
    if (props.initialFolderPath) mountFolder(props.initialFolderPath);
  }, [mountFolder, props.entry, props.initialFolderPath]);
  const studyCopy = flashcardStudyCopy(locale);

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
  }, []);

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (studying) return;
      if (createOpen) return;
      if (producing) {
        setPage('gallery');
        return;
      }
      props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createOpen, producing, props.onClose, studying]);

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
        {...(props.locale !== undefined ? { locale: props.locale } : {})}
        entry={study.entry}
        ports={studyPorts}
        onLeave={() => restoreLibrary(study.returnContext)}
      />
    );
  }

  const deckFilters =
    availableDecks.length > 0 ? (
      <div className="vault-chips" role="group" aria-label={t('Deck', '卡组')} data-testid="flashcards-deck-chips">
        <button
          type="button"
          className={`vault-chip${selectedDeck === 'all' ? ' is-on' : ''}`}
          aria-pressed={selectedDeck === 'all'}
          onClick={() => setSelectedDeck('all')}
        >
          <span>{t('All', '全部')}</span>
          <span className="vault-chip-count">{ws.cards.length}</span>
        </button>
        {availableDecks.map((deck) => (
          <button
            key={deck}
            type="button"
            className={`vault-chip${selectedDeck === deck ? ' is-on' : ''}`}
            data-testid={`flashcards-deck-${deck}`}
            aria-pressed={selectedDeck === deck}
            onClick={() => setSelectedDeck(deck)}
          >
            <span>{deck}</span>
            <span className="vault-chip-count">{deckCounts[deck] ?? 0}</span>
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className="vault-stage" data-testid="flashcards-workspace">
      <StudioTopbar
        testId="flashcards-back-btn"
        backLabel={producing ? t('Back to cards', '返回卡库') : t('Back', '返回')}
        onBack={() => (producing ? setPage('gallery') : props.onClose())}
        {...(props.locale !== undefined ? { locale: props.locale } : {})}
        kind="flashcards"
        {...(producing
          ? {}
          : {
              layout: 'page',
              titleCount: ws.cards.length,
              searchPlaceholder: t('Search cards…', '搜索闪卡…'),
              searchValue: search,
              onSearchChange: setSearch,
              ...(deckFilters !== null ? { filters: deckFilters } : {}),
              actions: (
                <div className="vault-bar-tools">
                  <Button
                    variant="secondary"
                    size="compact"
                    data-testid="flashcards-study-due"
                    onClick={() =>
                      enterStudy(
                        createStudyEntry({
                          mode: 'scheduled',
                          scope: scheduledScopeForDeck(selectedDeck),
                        }),
                        null,
                      )
                    }
                  >
                    <span>{studyCopy.due}</span>
                    {dueCount > 0 ? (
                      <span className="vault-chip-count">{studyCopy.dueDue(dueCount)}</span>
                    ) : null}
                    {newCount > 0 ? (
                      <span className="vault-chip-count">{studyCopy.dueNew(newCount)}</span>
                    ) : null}
                  </Button>
                  <Button variant="secondary" size="compact" onClick={() => setPage('produce')}>
                    <IconSpark width={13} height={13} aria-hidden="true" />
                    <span>{t('Produce', '出卡')}</span>
                  </Button>
                  <Button variant="primary" size="compact" onClick={() => setCreateOpen(true)}>
                    <IconPlus width={13} height={13} aria-hidden="true" />
                    <span>{t('Add card', '新增')}</span>
                  </Button>
                </div>
              ),
            })}
      />

      {producing ? (
        <ProduceStage
          produce={produce}
          locale={locale}
          projectPath={props.projectPath}
          onSeeCards={() => {
            setPage('gallery');
            void ws.reload();
          }}
          {...(props.onConfigureEmbedding
            ? { onConfigureEmbedding: props.onConfigureEmbedding }
            : {})}
          {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
        />
      ) : (
        <main className="vault-main flashcards-main" id="vault-main">
          {ws.error !== null && (
            <Notice tone="error" testId="flashcards-error">
              {ws.error}
            </Notice>
          )}
          {hostTooOld ? (
            <Notice tone="warning" testId="flashcards-study-host-old">
              {studyCopy.hostTooOld}
            </Notice>
          ) : null}

          {ws.loading ? (
            <div className="vault-empty">
              <Spinner label={t('Loading flashcards…', '正在加载闪卡…')} />
            </div>
          ) : tiles.length === 0 ? (
            <div className="vault-empty">
              <IconCards width={28} height={28} aria-hidden="true" />
              <h2>{t('No flashcards yet', '还没有闪卡')}</h2>
              <p>
                {t(
                  'Produce a set from a folder or workspace, or write one card.',
                  '从文件夹或工作空间出一套，或手写一张。',
                )}
              </p>
              <div className="vault-empty-actions">
                <Button variant="primary" size="compact" onClick={() => setPage('produce')}>
                  <IconSpark width={13} height={13} aria-hidden="true" />
                  <span>{t('Produce', '出卡')}</span>
                </Button>
                <Button variant="secondary" size="compact" onClick={() => setCreateOpen(true)}>
                  <IconPlus width={13} height={13} aria-hidden="true" />
                  <span>{t('Add card', '新增')}</span>
                </Button>
              </div>
            </div>
          ) : (
            <FlashcardGallery
              tiles={tiles}
              onOpen={(tileId) => {
                const tile = tiles.find((item) => item.id === tileId);
                if (!tile) return;
                enterStudy(
                  createStudyEntry({
                    mode: 'sequence',
                    scope: studyScopeForTile(tile),
                  }),
                  tileId,
                );
              }}
              onDeleteTile={(tile) => void deleteTile(tile.id)}
              labels={{
                delete: t('Delete tile', '删除此项'),
                openSet: t('Study set →', '过一遍 →'),
                openOne: t('Study →', '过一遍 →'),
                flipToAnswer: t('Show answer', '看答案'),
                flipToQuestion: t('Show question', '看问题'),
                answerFace: t('Answer', '答案'),
              }}
            />
          )}
        </main>
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

export type { FlashcardsRequester as FlashcardsWorkspaceRequester };
