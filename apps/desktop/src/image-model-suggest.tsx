/**
 * Image-model suggestion combobox for the Image Generation settings page.
 *
 * Replaces the old "discover → popup all models" flow with a smart dropdown:
 * 1. Fetch Pi's built-in image-generation catalog (35 models, static).
 * 2. Discover the provider's available models (network call).
 * 3. Match Pi image models to discovered models by split name (after last `/`).
 * 4. Dropdown shows only matched models (in Pi catalog order).
 * 5. A text button at the bottom reveals the remaining unmatched models.
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
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const loadedProviderIdRef = useRef<string | null>(null);

  // Load + match when the dropdown opens or the provider changes.
  useEffect(() => {
    if (!open || !provider) return;
    const providerId = provider.id;
    // Avoid re-fetching if we already loaded for this provider.
    if (loadedProviderIdRef.current === providerId && matched.length + unmatched.length > 0) {
      return;
    }
    loadedProviderIdRef.current = providerId;

    let cancelled = false;
    setLoading(true);
    setShowAll(false);
    setMatched([]);
    setUnmatched([]);

    async function load(): Promise<void> {
      // Fetch catalog and discovery independently so one failure
      // doesn't block the other.  If discovery fails we still show
      // all Pi catalog models as "unmatched" so the user can pick.
      let catalogEntries: ImageModelCatalogEntry[] = [];
      let discoveredIds: string[] = [];

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
        discoveredIds = discoverResult.models.map((m) => m.id);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        onDiscoverError?.(message);
      }

      if (cancelled) return;
      if (catalogEntries.length === 0 && discoveredIds.length > 0) {
        // Catalog unavailable (e.g. older host build) but we have
        // discovered models — show them as plain unmatched entries
        // so the user can still pick from the dropdown.
        const fallbackEntries: ImageModelCatalogEntry[] = discoveredIds.map((id) => ({
          catalogProviderId: '',
          modelId: id,
          name: id,
          input: [],
          output: [],
        }));
        setMatched([]);
        setUnmatched(fallbackEntries);
      } else {
        const result = matchImageCatalog(catalogEntries, discoveredIds);
        setMatched(result.matched);
        setUnmatched(result.unmatched);
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
  const visibleUnmatched: SuggestionItem[] = showAll
    ? unmatched.map((entry) => ({ kind: 'unmatched' as const, entry }))
    : [];

  // Apply query filter.
  const queryFilteredMatched = filterSuggestions(
    visibleMatched.map((m) => m.entry),
    value,
  );
  const filteredMatched: SuggestionItem[] = visibleMatched.filter((m) =>
    queryFilteredMatched.some((e) => e.modelId === m.entry.modelId),
  );
  const filteredUnmatched: SuggestionItem[] = showAll
    ? visibleUnmatched.filter((m) =>
        filterSuggestions([m.entry], value).length > 0,
      )
    : [];

  const allVisible = [...filteredMatched, ...filteredUnmatched];
  const hasUnmatched = unmatched.length > 0;

  // Reset highlight when the list changes.
  useEffect(() => {
    setHighlightIndex(allVisible.length > 0 ? 0 : -1);
  }, [matched, unmatched, showAll, value]);

  function selectItem(item: SuggestionItem): void {
    if (item.kind === 'matched') {
      onChange(item.matchedId);
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
        showAll: '显示全部生图模型',
        matched: '已匹配',
        all: '全部',
      }
    : {
        placeholder: 'Enter model ID, e.g. gpt-image-1',
        loading: 'Matching image models…',
        noMatch: 'No matching image models discovered',
        showAll: 'Show all image models',
        matched: 'matched',
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
              {allVisible.length === 0 && !hasUnmatched ? (
                <p className="image-model-suggest-empty muted">{t.noMatch}</p>
              ) : allVisible.length === 0 && hasUnmatched ? (
                <p className="image-model-suggest-empty muted">{t.noMatch}</p>
              ) : (
                <ul
                  id={listboxId}
                  role="listbox"
                  className="image-model-suggest-list"
                  data-testid="image-model-suggest-list"
                >
                  {allVisible.map((item, index) => {
                    const active = index === highlightIndex;
                    const entry = item.entry;
                    const displayName = entry.name !== entry.modelId ? entry.name : entry.modelId;
                    return (
                      <li key={entry.modelId} role="presentation">
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
                            {item.kind === 'matched' ? item.matchedId : entry.modelId}
                          </div>
                          <div className="image-model-suggest-option-meta muted">
                            {displayName !== entry.modelId ? <span>{displayName}</span> : null}
                            {item.kind === 'matched' ? (
                              <span className="image-model-suggest-badge">{t.matched}</span>
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
