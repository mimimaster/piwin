import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { DesktopTranslator } from './desktop-locale.js';
import { formatError, type DiscoveredModel, type ModelProviderConfig } from '@piwin/contracts';
import { Spinner } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context.js';
import { sortVideoDiscoveryModels } from './video-model-discovery.js';
import { defaultVideoGenerationPath, videoApiStyleLabel } from './video-generation-model-config.js';

type VideoGenerationCopy = DesktopTranslator['settings']['videoGeneration'];

export type VideoModelSuggestProps = {
  value: string;
  provider: ModelProviderConfig | null;
  /** Optional legacy test/consumer hook for the underlying text input. */
  inputTestId?: string;
  disabled?: boolean;
  discoverProviderModels: (provider: ModelProviderConfig) => Promise<{ models: DiscoveredModel[] }>;
  onChange: (model: DiscoveredModel) => void;
  onDiscoverError?: (message: string) => void;
};

type VideoSuggestionGroup = 'recognized' | 'suggested';

function getSuggestionGroup(model: DiscoveredModel): VideoSuggestionGroup {
  return model.capabilities?.includes('video-generation') ? 'recognized' : 'suggested';
}

function matchesQuery(model: DiscoveredModel, query: string): boolean {
  if (!query) {
    return true;
  }
  const normalizedQuery = query.toLowerCase();
  return (
    model.id.toLowerCase().includes(normalizedQuery) ||
    model.label?.toLowerCase().includes(normalizedQuery) === true
  );
}

export function VideoModelSuggest(props: VideoModelSuggestProps): ReactElement {
  const {
    value,
    provider,
    inputTestId = 'video-model-suggest-input',
    disabled,
    discoverProviderModels,
    onChange,
    onDiscoverError,
  } = props;
  const { locale, translator } = useDesktopLocale();
  const copy: VideoGenerationCopy = translator.settings.videoGeneration;
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const loadedProviderIdsRef = useRef<Set<string>>(new Set());
  const modelsByProviderIdRef = useRef<Map<string, DiscoveredModel[]>>(new Map());
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  useEffect(() => {
    if (!open || !provider) {
      return;
    }

    const selectedProvider = provider;
    const providerId = selectedProvider.id;
    if (loadedProviderIdsRef.current.has(providerId)) {
      setModels(modelsByProviderIdRef.current.get(providerId) ?? []);
      setLoading(false);
      return;
    }

    loadedProviderIdsRef.current.add(providerId);
    let cancelled = false;
    setModels([]);
    setLoading(true);

    async function loadModels(): Promise<void> {
      try {
        const result = await discoverProviderModels(selectedProvider);
        if (cancelled) {
          return;
        }
        const discoveredModels = sortVideoDiscoveryModels(result.models);
        modelsByProviderIdRef.current.set(providerId, discoveredModels);
        setModels(discoveredModels);
      } catch (error) {
        if (cancelled) {
          return;
        }
        modelsByProviderIdRef.current.set(providerId, []);
        setModels([]);
        onDiscoverError?.(formatError(error));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadModels();
    return () => {
      cancelled = true;
      if (!modelsByProviderIdRef.current.has(providerId)) {
        loadedProviderIdsRef.current.delete(providerId);
      }
    };
  }, [discoverProviderModels, onDiscoverError, open, provider]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: MouseEvent): void {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || root.contains(event.target)) {
        return;
      }
      setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const query = value.trim().toLowerCase();
  const visibleModels = models.filter((model) => matchesQuery(model, query));
  const recognizedModels = visibleModels.filter(
    (model) => getSuggestionGroup(model) === 'recognized',
  );
  const suggestedModels = visibleModels.filter(
    (model) => getSuggestionGroup(model) === 'suggested',
  );

  useEffect(() => {
    setHighlightIndex(visibleModels.length > 0 ? 0 : -1);
  }, [models, value]);

  function selectModel(model: DiscoveredModel): void {
    onChange(model);
    setOpen(false);
  }

  function handleInputChange(nextValue: string): void {
    // A typed value is represented as a minimal discovered model. This keeps
    // the selector controlled while leaving all form/config mutation to the
    // settings page's existing save path.
    onChange({ id: nextValue });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (!open && event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (visibleModels.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((index) => (index + 1) % visibleModels.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((index) => (index <= 0 ? visibleModels.length - 1 : index - 1));
    } else if (event.key === 'Enter') {
      const model = visibleModels[highlightIndex];
      if (model) {
        event.preventDefault();
        selectModel(model);
      }
    }
  }

  function renderModelOption(model: DiscoveredModel): ReactElement {
    const suggestion = model.videoGenerationSuggestion;
    const recognized = getSuggestionGroup(model) === 'recognized';
    const apiStyle = suggestion?.apiStyle;
    const path = suggestion?.path ?? (apiStyle ? defaultVideoGenerationPath(apiStyle) : undefined);
    const modelIndex = visibleModels.indexOf(model);
    const active = modelIndex === highlightIndex;

    return (
      <li key={model.id} role="presentation">
        <button
          type="button"
          id={`${listboxId}-option-${modelIndex}`}
          role="option"
          aria-selected={active}
          className={`video-model-suggest-option${active ? ' is-active' : ''}`}
          data-testid="video-model-suggest-option"
          data-model-id={model.id}
          onMouseEnter={() => setHighlightIndex(modelIndex)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectModel(model)}
        >
          <span className="video-model-suggest-option-main">
            <span className="video-model-suggest-option-id">{model.id}</span>
            {model.label && model.label !== model.id ? (
              <span className="video-model-suggest-option-label">{model.label}</span>
            ) : null}
          </span>
          <span className="video-model-suggest-option-meta muted">
            {recognized ? (
              <>
                <span>{apiStyle ? videoApiStyleLabel(apiStyle, locale) : '—'}</span>
                <span>{path ?? '—'}</span>
              </>
            ) : (
              copy.suggestionAddsVideoModel
            )}
          </span>
        </button>
      </li>
    );
  }

  return (
    <div ref={rootRef} className="video-model-suggest" data-testid="video-model-suggest">
      <input
        className="mcp-raw-editor"
        style={{ height: 'auto', padding: '8px 12px', width: '100%' }}
        data-testid={inputTestId}
        value={value}
        onChange={(event) => handleInputChange(event.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={copy.modelSuggestPlaceholder}
        spellCheck={false}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          open && highlightIndex >= 0 ? `${listboxId}-option-${highlightIndex}` : undefined
        }
      />

      {open ? (
        <div className="video-model-suggest-dropdown" data-testid="video-model-suggest-dropdown">
          {loading ? (
            <div className="video-model-suggest-loading">
              <Spinner />
              <span className="muted">{copy.modelSuggestLoading}</span>
            </div>
          ) : visibleModels.length === 0 ? (
            <p className="video-model-suggest-empty muted">{copy.modelSuggestEmpty}</p>
          ) : (
            <div id={listboxId} role="listbox" className="video-model-suggest-list">
              {recognizedModels.length > 0 ? (
                <section
                  className="video-model-suggest-group"
                  data-testid="video-model-suggest-group-recognized"
                >
                  <h4 className="video-model-suggest-group-label">{copy.recognizedModels}</h4>
                  <ul>{recognizedModels.map((model) => renderModelOption(model))}</ul>
                </section>
              ) : null}
              {suggestedModels.length > 0 ? (
                <section
                  className="video-model-suggest-group"
                  data-testid="video-model-suggest-group-suggested"
                >
                  <h4 className="video-model-suggest-group-label">{copy.suggestedModels}</h4>
                  <ul>{suggestedModels.map((model) => renderModelOption(model))}</ul>
                </section>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
