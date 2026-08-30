import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, Notice, Spinner } from '@piwin/ui-kit';
import type { FlashcardCreateInput, HostResponse } from '@piwin/contracts';
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
import { TearDeck } from './flashcards/tear-deck';
import { useModalFocus } from './studio/use-modal-focus';

export type FlashcardsHomeCommand = FlashcardsLibraryCommand | FlashcardsProduceCommand;
export type FlashcardsRequester = (command: FlashcardsHomeCommand) => Promise<HostResponse>;

export type FlashcardsWorkspaceViewProps = {
  locale?: DesktopLocale;
  onClose: () => void;
  request: FlashcardsRequester;
  projectPath?: string | null | undefined;
  onConfigureEmbedding?: (() => void) | undefined;
};

/** Flashcards home — tiled library; produce is a page jump into the folder loop. */
export function FlashcardsWorkspaceView(props: FlashcardsWorkspaceViewProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const locale = isZh ? 'zh-CN' : 'en';

  const [search, setSearch] = useState('');
  const [selectedDeck, setSelectedDeck] = useState<string>('all');
  const [page, setPage] = useState<'gallery' | 'produce'>('gallery');
  const [openTileId, setOpenTileId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newDeck, setNewDeck] = useState('');
  const [newFront, setNewFront] = useState('');
  const [newBack, setNewBack] = useState('');

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

  const openTile = tiles.find((tile) => tile.id === openTileId);
  const reviewDialogRef = useModalFocus<HTMLDivElement>(
    () => setOpenTileId(null),
    openTile !== undefined,
  );
  const producing = page === 'produce';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (openTileId !== null) {
        setOpenTileId(null);
        return;
      }
      if (createOpen) return;
      if (producing) {
        setPage('gallery');
        return;
      }
      props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createOpen, openTileId, producing, props.onClose]);

  const deleteTile = useCallback(
    async (tileId: string) => {
      const tile = allGroupedTiles.find((item) => item.id === tileId);
      if (!tile) return;
      const ids = tileCards(tile).map((card) => card.id);
      const ok = ids.length === 1 ? await ws.remove(ids[0] ?? '') : await ws.removeMany(ids);
      if (ok) {
        if (openTileId === tileId) {
          setOpenTileId(null);
        }
        await ws.reload();
      }
    },
    [allGroupedTiles, openTileId, ws],
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
        {...(producing ? {} : { titleCount: ws.cards.length })}
        {...(producing
          ? {}
          : {
              searchPlaceholder: t('Search cards…', '搜索闪卡…'),
              searchValue: search,
              onSearchChange: setSearch,
              ...(deckFilters !== null ? { filters: deckFilters } : {}),
            })}
        actions={
          producing ? (
            <span className="vault-bar-context">{t('Produce', '出卡')}</span>
          ) : (
            <div className="vault-bar-tools">
              <Button variant="secondary" size="compact" onClick={() => setPage('produce')}>
                <IconSpark width={13} height={13} aria-hidden="true" />
                <span>{t('Produce', '出卡')}</span>
              </Button>
              <Button variant="primary" size="compact" onClick={() => setCreateOpen(true)}>
                <IconPlus width={13} height={13} aria-hidden="true" />
                <span>{t('Add card', '新增')}</span>
              </Button>
            </div>
          )
        }
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
        />
      ) : (
        <main className="vault-main flashcards-main" id="vault-main">
          {ws.error !== null && (
            <Notice tone="error" testId="flashcards-error">
              {ws.error}
            </Notice>
          )}

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
              onOpen={setOpenTileId}
              onDeleteTile={(tile) => void deleteTile(tile.id)}
              deleteLabel={t('Delete tile', '删除此项')}
            />
          )}
        </main>
      )}

      {openTile ? (
        <div className="vault-study-back" onClick={() => setOpenTileId(null)}>
          <div
            ref={reviewDialogRef}
            className="vault-study"
            data-testid="flashcards-tear-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('Flashcard review', '闪卡复习')}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <TearDeck
              cards={tileCards(openTile)}
              labels={{
                flipHint: t('Show answer', '查看答案'),
                tear: t('Next', '下一张'),
                lastCard: t('Finish', '完成'),
                close: t('Close', '关闭'),
                deleteCard: t('Delete this card', '删这张'),
                deleteSet: t('Delete this set', '删这套'),
                answer: t('Answer', '答案'),
                question: t('Question', '问题'),
                remaining: (count) => t(`${count} remaining`, `剩余 ${count} 张`),
                revealShortcut: t('Space · show answer', '空格 · 查看答案'),
                nextShortcut: t('Enter or → · next', '回车或 → · 下一张'),
                completedTitle: t('Review complete', '复习完成'),
                completedDescription: (count) =>
                  t(`You reviewed all ${count} cards.`, `已完成全部 ${count} 张卡片。`),
                restart: t('Review again', '再来一遍'),
              }}
              onClose={() => setOpenTileId(null)}
              onDeleteCard={async (cardId) => {
                const ok = await ws.remove(cardId);
                if (ok) {
                  await ws.reload();
                  if (openTile.kind === 'single') setOpenTileId(null);
                }
              }}
              onDeleteSet={() => void deleteTile(openTile.id)}
            />
          </div>
        </div>
      ) : null}

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
