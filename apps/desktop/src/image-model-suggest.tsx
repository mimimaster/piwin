/**
 * Image-model suggestion combobox for the Image Generation settings page.
 *
 * Replaces the old "discover → popup all models" flow with a smart dropdown:
 * 1. Fetch Pi's built-in image-generation catalog (35 models, static).
 * 2. Discover the provider's available models (network call).
 * 3. Match Pi image models to discovered models by split name (after last `/`).
 * 4. Dropdown shows matched models + discovered image-like models that are not
 *    in the Pi catalog (SiliconFlow / local gateways).
 * 5. A text button at the bottom reveals remaining Pi catalog models.
 *
 * Selecting a suggestion fills the model-id input with the discovered model id
 * (not the Pi catalog id) so the rest of the form works as before.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { Spinner } from '@piwin/ui-kit';
import { formatError } from '@piwin/contracts';
import type {
  DiscoveredModel,
  ImageModelCatalogEntry,
  ModelProviderConfig,
} from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context.js';
import {
  filterSuggestions,
  matchImageCatalog,
  type SuggestionMatch,
} from './image-model-suggest.js';

export type ImageModelSuggestProps = {
  value: string;
  onChange: (value: string) => void;
  provider: ModelProviderConfig | null;
  disabled?: boolean;
  /** Fetch Pi's built-in image-generation catalog. */
  searchImageModelCatalog: () => Promise<{
    entries: ImageModelCatalogEntry[];
    catalogVersion: string;
  }>;
  /** Discover models from the provider's API. */
  discoverProviderModels: (
    provider: ModelProviderConfig,
  ) => Promise<{ models: DiscoveredModel[] }>;
  onDiscoverError?: (message: string) => void;
};

type SuggestionItem =
  | { kind: 'matched'; entry: ImageModelCatalogEntry; matchedId: string }
  | { kind: 'discovered'; modelId: string; label: string }
  | { kind: 'unmatched'; entry: ImageModelCatalogEntry };

export function ImageModelSuggest(props: ImageModelSuggestProps): ReactElement {
  const { value, onChange, provider, disabled, searchImageModelCatalog, discoverProviderModels, onDiscoverError } = props;
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const listboxId = useId();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [matched, setMatched] = useState<SuggestionMatch[]>([]);
  const [unmatched, setUnmatched] = useState<ImageModelCatalogEntry[]>([]);
  const [discoveredOnly, setDiscoveredOnly] = useState<
    Array<{ modelId: string; label: string }>
  >([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const loadedProviderIdRef = useRef<string | null>(null);

  // Load + match when the dropdown opens or the provider changes.
  useEffect(() => {
    if (!open || !provider) return;
    const providerId = provider.id;
    // Avoid re-fetching if we already loaded for this provider.
    if (
      loadedProviderIdRef.current === providerId &&
      matched.length + unmatched.length + discoveredOnly.length > 0
    ) {
      return;
    }
    loadedProviderIdRef.current = providerId;

    let cancelled = false;
    setLoading(true);
    setShowAll(false);
    setMatched([]);
    setUnmatched([]);
    setDiscoveredOnly([]);

    async function load(): Promise<void> {
      // Fetch catalog and discovery independently so one failure
      // doesn't block the other.  If discovery fails we still show
      // all Pi catalog models as "unmatched" so the user can pick.
      let catalogEntries: ImageModelCatalogEntry[] = [];
      let discoveredModels: DiscoveredModel[] = [];

      try {
        const catalogResult = await searchImageModelCatalog();
        if (cancelled) return;
        catalogEntries = catalogResult.entries;
      } catch {
        // Catalog may be unavailable on older host builds.
      }

      try {
        const discoverResult = await discoverProviderModels(provider!);
        if (cancelled) return;
        discoveredModels = discoverResult.models;
      } catch (error) {
        if (cancelled) return;
        const message = formatError(error);
        onDiscoverError?.(message);
      }

      if (cancelled) return;
      const discoveredIds = discoveredModels.map((model) => model.id);
      const labelsById: Record<string, string> = {};
      const capabilitiesById: Record<string, readonly string[]> = {};
      for (const model of discoveredModels) {
        if (model.label?.trim()) {
          labelsById[model.id] = model.label.trim();
        }
        if (model.capabilities?.length) {
          capabilitiesById[model.id] = model.capabilities;
        }
      }

      if (catalogEntries.length === 0 && discoveredIds.length > 0) {
        // Catalog unavailable (e.g. older host build) but we have
        // discovered models — prefer image-like ones in the primary list.
        const result = matchImageCatalog([], discoveredIds, {
          labelsById,
          capabilitiesById,
        });
        setMatched([]);
        setUnmatched([]);
        // If heuristics find nothing, still offer every discovered id so the
        // user can pick (better than an empty dropdown).
        setDiscoveredOnly(
          result.discoveredOnly.length > 0
            ? result.discoveredOnly
            : discoveredModels.map((model) => ({
                modelId: model.id,
                label: model.label?.trim() || model.id,
              })),
        );
      } else {
        const result = matchImageCatalog(catalogEntries, discoveredIds, {
          labelsById,
          capabilitiesById,
        });
        setMatched(result.matched);
        setUnmatched(result.unmatched);
        setDiscoveredOnly(result.discoveredOnly);
      }
    }

    void load().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider?.id]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Build the visible items list.
  const visibleMatched: SuggestionItem[] = matched.map((m) => ({
    kind: 'matched' as const,
    entry: m.entry,
    matchedId: m.matchedId,
  }));
  const visibleDiscovered: SuggestionItem[] = discoveredOnly.map((item) => ({
    kind: 'discovered' as const,
    modelId: item.modelId,
    label: item.label,
  }));
  const visibleUnmatched: SuggestionItem[] = showAll
    ? unmatched.map((entry) => ({ kind: 'unmatched' as const, entry }))
    : [];

  // Apply query filter.
  const matchedEntries = visibleMatched
    .filter((m): m is Extract<SuggestionItem, { kind: 'matched' }> => m.kind === 'matched')
    .map((m) => m.entry);
  const queryFilteredMatched = filterSuggestions(matchedEntries, value);
  const filteredMatched: SuggestionItem[] = visibleMatched.filter(
    (m) => m.kind === 'matched' && queryFilteredMatched.some((e) => e.modelId === m.entry.modelId),
  );
  const queryLower = value.trim().toLowerCase();
  const filteredDiscovered: SuggestionItem[] = visibleDiscovered.filter((item) => {
    if (item.kind !== 'discovered') return false;
    if (!queryLower) return true;
    return (
      item.modelId.toLowerCase().includes(queryLower) ||
      item.label.toLowerCase().includes(queryLower)
    );
  });
  const filteredUnmatched: SuggestionItem[] = showAll
    ? visibleUnmatched.filter(
        (m) => m.kind === 'unmatched' && filterSuggestions([m.entry], value).length > 0,
      )
    : [];

  // Discovered channel models first (what the user can actually call), then
  // catalog matches, then optional full Pi catalog.
  const allVisible = [...filteredDiscovered, ...filteredMatched, ...filteredUnmatched];
  const hasUnmatched = unmatched.length > 0;
  const hasPrimary =
    filteredDiscovered.length > 0 || filteredMatched.length > 0;

  // Reset highlight when the list changes.
  useEffect(() => {
    setHighlightIndex(allVisible.length > 0 ? 0 : -1);
  }, [matched, unmatched, discoveredOnly, showAll, value]);

  function selectItem(item: SuggestionItem): void {
    if (item.kind === 'matched') {
      onChange(item.matchedId);
    } else if (item.kind === 'discovered') {
      onChange(item.modelId);
    } else {
      onChange(item.entry.modelId);
    }
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!open || allVisible.length === 0) {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'ArrowDown' && !open) {
        setOpen(true);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((i) => (i + 1) % allVisible.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? allVisible.length - 1 : i - 1));
      return;
    }
    if (event.key === 'Enter') {
      const item = allVisible[highlightIndex];
      if (item) {
        event.preventDefault();
        selectItem(item);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  const t = isChinese
    ? {
        placeholder: '输入模型 ID，如 gpt-image-1',
        loading: '正在匹配生图模型…',
        noMatch: '该通道未发现匹配的生图模型',
        noChannelImage: '该通道未发现生图相关模型，可展开 Pi 目录或手动输入',
        showAll: '显示全部生图模型',
        matched: '已匹配',
        channel: '通道',
        all: '全部',
      }
    : {
        placeholder: 'Enter model ID, e.g. gpt-image-1',
        loading: 'Matching image models…',
        noMatch: 'No matching image models discovered',
        noChannelImage: 'No image-like models on this channel — expand the Pi catalog or type an ID',
        showAll: 'Show all image models',
        matched: 'matched',
        channel: 'channel',
        all: 'all',
      };

  return (
    <div ref={rootRef} className="image-model-suggest" data-testid="image-model-suggest">
      <input
        className="mcp-raw-editor"
        style={{ height: 'auto', padding: '8px 12px', flex: 1, width: '100%' }}
        data-testid="image-model-suggest-input"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          if (!open) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={t.placeholder}
        spellCheck={false}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          open && highlightIndex >= 0
            ? `${listboxId}-option-${highlightIndex}`
            : undefined
        }
      />

      {open && (
        <div className="image-model-suggest-dropdown" data-testid="image-model-suggest-dropdown">
          {loading ? (
            <div className="image-model-suggest-loading">
              <Spinner />
              <span className="muted" style={{ marginLeft: 8 }}>{t.loading}</span>
            </div>
          ) : (
            <>
              {allVisible.length === 0 && !hasUnmatched && discoveredOnly.length === 0 ? (
                <p className="image-model-suggest-empty muted">{t.noMatch}</p>
              ) : allVisible.length === 0 && (hasUnmatched || discoveredOnly.length > 0) ? (
                <p className="image-model-suggest-empty muted">
                  {hasPrimary ? t.noMatch : t.noChannelImage}
                </p>
              ) : (
                <ul
                  id={listboxId}
                  role="listbox"
                  className="image-model-suggest-list"
                  data-testid="image-model-suggest-list"
                >
                  {allVisible.map((item, index) => {
                    const active = index === highlightIndex;
                    const optionId =
                      item.kind === 'matched'
                        ? item.matchedId
                        : item.kind === 'discovered'
                          ? item.modelId
                          : item.entry.modelId;
                    const metaLabel =
                      item.kind === 'matched'
                        ? item.entry.name !== item.entry.modelId
                          ? item.entry.name
                          : null
                        : item.kind === 'discovered'
                          ? item.label !== item.modelId
                            ? item.label
                            : null
                          : item.entry.name !== item.entry.modelId
                            ? item.entry.name
                            : null;
                    return (
                      <li
                        key={`${item.kind}:${optionId}:${item.kind === 'matched' ? item.entry.modelId : ''}`}
                        role="presentation"
                      >
                        <button
                          type="button"
                          id={`${listboxId}-option-${index}`}
                          role="option"
                          aria-selected={active}
                          className={
                            active
                              ? 'image-model-suggest-option is-active'
                              : 'image-model-suggest-option'
                          }
                          onMouseEnter={() => setHighlightIndex(index)}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            selectItem(item);
                          }}
                        >
                          <div className="image-model-suggest-option-id">
                            {optionId}
                          </div>
                          <div className="image-model-suggest-option-meta muted">
                            {metaLabel ? <span>{metaLabel}</span> : null}
                            {item.kind === 'matched' ? (
                              <span className="image-model-suggest-badge">{t.matched}</span>
                            ) : item.kind === 'discovered' ? (
                              <span className="image-model-suggest-badge">{t.channel}</span>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {!showAll && hasUnmatched && (
                <button
                  type="button"
                  className="image-model-suggest-show-all"
                  data-testid="image-model-suggest-show-all"
                  onClick={() => setShowAll(true)}
                >
                  {t.showAll}（{unmatched.length}）
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
