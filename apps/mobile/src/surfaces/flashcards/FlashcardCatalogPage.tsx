import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  FLASHCARD_STUDY_CATALOG_DEFAULT_LIMIT,
  type FlashcardStudyCatalogPage,
  type FlashcardStudyTileSummary,
  type FlashcardStudyUnfinishedRoundSummary,
  type HostResponse,
} from '@piwin/contracts';
import { Button, EmptyState, IconBack, IconCards, Notice, Spinner } from '@piwin/ui-kit';
import { stripHostAbsolutePaths } from './catalog-paths.js';
import { startValidatedStudyRound, type ChatStudyRequest } from './chat-study-entry.js';
import { MOBILE_FLASHCARD_STUDY_COPY as copy } from './study-copy.js';
import {
  captureMobileStudyReturnContext,
  saveMobileStudyReturnContext,
  scheduledScopeForDeck,
  studyScopeForTile,
} from './study-return-context.js';

export type FlashcardCatalogPageProps = {
  request: ChatStudyRequest;
  connected: boolean;
  hasStudyCapability: () => boolean;
  onOpenStudy: (roundId: string) => void;
  onBack: () => void;
  initialDeck?: string;
  initialSearch?: string;
  initialScrollTop?: number;
};

function readCatalog(response: HostResponse): FlashcardStudyCatalogPage | null {
  if (!response.success || response.data === undefined) return null;
  return stripHostAbsolutePaths(response.data) as FlashcardStudyCatalogPage;
}

export function FlashcardCatalogPage(props: FlashcardCatalogPageProps): ReactElement {
  const { request, connected, hasStudyCapability } = props;
  const [search, setSearch] = useState(props.initialSearch ?? '');
  const [selectedDeck, setSelectedDeck] = useState(props.initialDeck ?? 'all');
  const [page, setPage] = useState<FlashcardStudyCatalogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [hostTooOld, setHostTooOld] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const query = search.trim();

  const load = useCallback(
    async (cursor?: string) => {
      if (!connected) {
        setLoading(false);
        return;
      }
      if (!hasStudyCapability()) {
        setHostTooOld(true);
        setLoading(false);
        return;
      }
      setHostTooOld(false);
      setLoading(true);
      setError(null);
      const response = await request({
        type: 'flashcards/study/catalog',
        limit: FLASHCARD_STUDY_CATALOG_DEFAULT_LIMIT,
        ...(query.length > 0 ? { query } : {}),
        ...(selectedDeck !== 'all' ? { scopeFilter: scheduledScopeForDeck(selectedDeck) } : {}),
        ...(cursor ? { cursor } : {}),
      });
      setLoading(false);
      if (!response.success) {
        if (response.problem?.code === 'host-too-old') setHostTooOld(true);
        setError({
          code: response.problem?.code ?? 'catalog-error',
          message: response.error || copy.emptyCatalogBody,
        });
        return;
      }
      const next = readCatalog(response);
      if (!next) {
        setError({ code: 'catalog-error', message: copy.emptyCatalogBody });
        return;
      }
      setPage((prev) => {
        if (!cursor || !prev) return next;
        return {
          ...next,
          tiles: [...prev.tiles, ...next.tiles],
          unfinishedRounds: next.unfinishedRounds,
        };
      });
    },
    [connected, hasStudyCapability, query, request, selectedDeck],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (props.initialScrollTop && listRef.current) {
      listRef.current.scrollTop = props.initialScrollTop;
    }
  }, [props.initialScrollTop, page]);

  const decks = useMemo(() => {
    const names = new Set<string>();
    for (const tile of page?.tiles ?? []) {
      if (tile.deck) names.add(tile.deck);
    }
    return [...names].sort();
  }, [page?.tiles]);

  const captureReturn = (focusTileId: string | null) => {
    saveMobileStudyReturnContext(
      captureMobileStudyReturnContext({
        source: 'catalog',
        selectedDeck,
        search,
        scrollTop: listRef.current?.scrollTop ?? 0,
        focusTileId,
      }),
    );
  };

  const openStarted = async (start: Parameters<typeof startValidatedStudyRound>[0], focusTileId: string | null) => {
    const result = await startValidatedStudyRound(start);
    if (!result.ok) {
      setError({ code: result.code, message: result.error });
      if (result.code === 'host-too-old') setHostTooOld(true);
      return;
    }
    captureReturn(focusTileId);
    props.onOpenStudy(result.roundId);
  };

  const openTile = (tile: FlashcardStudyTileSummary) => {
    void openStarted(
      {
        request: props.request,
        scope: studyScopeForTile(tile),
        mode: 'sequence',
        resumeExisting: true,
        hasStudyCapability: props.hasStudyCapability,
      },
      tile.id,
    );
  };

  const openDue = () => {
    void openStarted(
      {
        request: props.request,
        scope: scheduledScopeForDeck(selectedDeck),
        mode: 'scheduled',
        resumeExisting: true,
        hasStudyCapability: props.hasStudyCapability,
      },
      null,
    );
  };

  const openUnfinished = (round: FlashcardStudyUnfinishedRoundSummary) => {
    captureReturn(null);
    props.onOpenStudy(round.roundId);
  };

  return (
    <div className="mobile-flashcards-page" data-testid="flashcards-catalog-page">
      <header className="mobile-flashcards-header">
        <button
          type="button"
          className="mobile-flashcards-back"
          data-testid="flashcards-catalog-back"
          onClick={props.onBack}
          aria-label={copy.backChat}
        >
          <IconBack size={20} />
          <span>{copy.backChat}</span>
        </button>
        <h1 className="mobile-flashcards-title">{copy.catalogTitle}</h1>
        <span className="mobile-flashcards-header-spacer" />
      </header>

      <div className="mobile-flashcards-body" ref={listRef}>
        {!props.connected ? (
          <EmptyState
            title={copy.notConnected}
            description={copy.notConnectedBody}
            action={
              <Button variant="secondary" onClick={props.onBack}>
                {copy.backChat}
              </Button>
            }
            testId="flashcards-catalog-disconnected"
          />
        ) : null}

        {hostTooOld ? (
          <Notice tone="error" testId="flashcards-catalog-host-old" title={copy.hostTooOld}>
            {copy.hostTooOldBody}
          </Notice>
        ) : null}

        {error && !hostTooOld ? (
          <Notice tone="error" testId="flashcards-catalog-error">
            {error.message}
          </Notice>
        ) : null}

        {props.connected && !hostTooOld ? (
          <>
            <div className="mobile-flashcards-toolbar">
              <input
                type="search"
                className="mobile-flashcards-search"
                placeholder={copy.searchPlaceholder}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={copy.searchPlaceholder}
              />
              <div className="mobile-flashcards-scopes">
                <button
                  type="button"
                  className={`mobile-flashcards-chip ${selectedDeck === 'all' ? 'active' : ''}`}
                  onClick={() => setSelectedDeck('all')}
                >
                  {copy.allScope}
                </button>
                {decks.map((deck) => (
                  <button
                    key={deck}
                    type="button"
                    className={`mobile-flashcards-chip ${selectedDeck === deck ? 'active' : ''}`}
                    onClick={() => setSelectedDeck(deck)}
                  >
                    {deck}
                  </button>
                ))}
              </div>
              <Button
                variant="primary"
                data-testid="flashcards-study-due"
                onClick={openDue}
                disabled={!props.hasStudyCapability() || (page !== null && page.dueCount === 0 && page.newCount === 0)}
              >
                {copy.due}
                {page ? ` · ${copy.dueDue(page.dueCount)} ${copy.dueNew(page.newCount)}` : ''}
              </Button>
            </div>

            {(page?.unfinishedRounds.length ?? 0) > 0 ? (
              <section className="mobile-flashcards-section">
                <h2>未完成轮次</h2>
                {page?.unfinishedRounds.map((round) => (
                  <button
                    key={round.roundId}
                    type="button"
                    className="mobile-flashcards-tile"
                    data-testid={`flashcards-unfinished-${round.roundId}`}
                    onClick={() => openUnfinished(round)}
                  >
                    <span className="mobile-flashcards-tile-kind">
                      {round.mode === 'scheduled' ? copy.scheduledTitle : copy.sequenceTitle}
                    </span>
                    <span>
                      {copy.unfinished(round.counts.processed, round.counts.total)} · {copy.continueRound}
                    </span>
                  </button>
                ))}
              </section>
            ) : null}

            <section className="mobile-flashcards-section">
              <h2>卡库</h2>
              {loading && !page ? (
                <div className="mobile-flashcards-loading">
                  <Spinner label={copy.saving} />
                </div>
              ) : null}
              {page && page.tiles.length === 0 && !loading ? (
                <EmptyState
                  title={copy.emptyCatalogTitle}
                  description={copy.emptyCatalogBody}
                  visual={<IconCards size={28} />}
                  testId="flashcards-catalog-empty"
                />
              ) : null}
              {page?.tiles.map((tile) => (
                <button
                  key={tile.id}
                  type="button"
                  className="mobile-flashcards-tile"
                  data-testid={`flashcard-tile-${tile.id}`}
                  onClick={() => openTile(tile)}
                >
                  <span className="mobile-flashcards-tile-kind">
                    {tile.kind === 'set' ? `套 · ${tile.count}` : '单张'}
                    {tile.deck ? ` · ${tile.deck}` : ''}
                  </span>
                  <span className="mobile-flashcards-tile-preview">{tile.preview}</span>
                </button>
              ))}
              {page?.nextCursor ? (
                <Button variant="secondary" onClick={() => void load(page.nextCursor)} disabled={loading}>
                  {copy.loadMore}
                </Button>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
