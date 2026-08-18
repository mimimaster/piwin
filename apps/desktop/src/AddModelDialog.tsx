import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Button, Field, Modal, TextInput } from '@piwin/ui-kit';
import type { ModelCatalogEntry, ModelConfigEntry, ModelProviderConfig } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';
import {
  EMPTY_GENERATION_ROUTE_FIELDS,
  withImageGenerationEnabled,
  withVideoGenerationEnabled,
} from './generation-route-defaults';
import {
  createModelConfigurationEntry,
  type ModelConfigurationDraft,
} from './model-configuration';
import { ModelGenerationRouteFields } from './model-generation-route-fields';

export type AddModelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingModelIds: readonly string[];
  onAdd: (model: ModelConfigEntry) => void;
  /** Channel protocol; used only to suggest image/video wire defaults. */
  protocol?: ModelProviderConfig['protocol'];
  /** Optional catalog autocomplete (host `models/catalog/search`). */
  searchCatalog?: (query: string) => Promise<ModelCatalogEntry[]>;
};

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

export function AddModelDialog({
  open,
  onOpenChange,
  existingModelIds,
  onAdd,
  protocol = 'openai-compatible',
  searchCatalog,
}: AddModelDialogProps): ReactElement {
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.provider;
  const common = translator.common;
  const isChinese = locale === 'zh-CN';
  const listboxId = useId();
  const [modelId, setModelId] = useState('');
  const [label, setLabel] = useState('');
  const [groupName, setGroupName] = useState('');
  const [contextWindow, setContextWindow] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');
  const [supportsImage, setSupportsImage] = useState(false);
  const [imageGeneration, setImageGeneration] = useState(false);
  const [videoGeneration, setVideoGeneration] = useState(false);
  const [speechToText, setSpeechToText] = useState(false);
  const [textToSpeech, setTextToSpeech] = useState(false);
  const [nativeWebSearch, setNativeWebSearch] = useState(false);
  const [imageApiStyle, setImageApiStyle] = useState(EMPTY_GENERATION_ROUTE_FIELDS.imageApiStyle);
  const [imagePath, setImagePath] = useState('');
  const [imageGenTimeout, setImageGenTimeout] = useState('');
  const [videoApiStyle, setVideoApiStyle] = useState(EMPTY_GENERATION_ROUTE_FIELDS.videoApiStyle);
  const [videoPath, setVideoPath] = useState('');
  const [videoTimeoutSeconds, setVideoTimeoutSeconds] = useState('');
  const [videoPollIntervalSeconds, setVideoPollIntervalSeconds] = useState('');
  const [reasoning, setReasoning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ModelCatalogEntry[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setModelId('');
    setLabel('');
    setGroupName('');
    setContextWindow('');
    setMaxOutputTokens('');
    setSupportsImage(false);
    setImageGeneration(false);
    setVideoGeneration(false);
    setSpeechToText(false);
    setTextToSpeech(false);
    setNativeWebSearch(false);
    setImageApiStyle(EMPTY_GENERATION_ROUTE_FIELDS.imageApiStyle);
    setImagePath('');
    setImageGenTimeout('');
    setVideoApiStyle(EMPTY_GENERATION_ROUTE_FIELDS.videoApiStyle);
    setVideoPath('');
    setVideoTimeoutSeconds('');
    setVideoPollIntervalSeconds('');
    setReasoning(true);
    setError(null);
    setSuggestions([]);
    setCatalogOpen(false);
    setSearching(false);
    setHighlightIndex(-1);
    searchSeq.current += 1;
  }, [open]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!catalogOpen) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) {
        setCatalogOpen(false);
        setHighlightIndex(-1);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [catalogOpen]);

  function applyCatalogEntry(entry: ModelCatalogEntry): void {
    setModelId(entry.modelId);
    setLabel(entry.name !== entry.modelId ? entry.name : '');
    setContextWindow(String(entry.contextWindow));
    setMaxOutputTokens(String(entry.maxTokens));
    setSupportsImage(entry.input.includes('image'));
    setReasoning(entry.reasoning);
    setCatalogOpen(false);
    setSuggestions([]);
    setHighlightIndex(-1);
    setError(null);
  }

  function runCatalogSearch(query: string): void {
    if (!searchCatalog) {
      return;
    }
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      searchSeq.current += 1;
      setSuggestions([]);
      setCatalogOpen(false);
      setSearching(false);
      setHighlightIndex(-1);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      void searchCatalog(trimmed)
        .then((entries) => {
          if (seq !== searchSeq.current) return;
          const next = entries.slice(0, 8);
          setSuggestions(next);
          setCatalogOpen(next.length > 0);
          setHighlightIndex(next.length > 0 ? 0 : -1);
          setSearching(false);
        })
        .catch((err: unknown) => {
          if (seq !== searchSeq.current) return;
          console.warn('[AddModelDialog] catalog search failed', err);
          setSuggestions([]);
          setCatalogOpen(false);
          setHighlightIndex(-1);
          setSearching(false);
        });
    }, 200);
  }

  function onModelIdChange(value: string): void {
    setModelId(value);
    setError(null);
    runCatalogSearch(value);
  }

  function onModelIdKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!catalogOpen || suggestions.length === 0) {
      if (event.key === 'Escape') {
        setCatalogOpen(false);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((index) => (index + 1) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
      return;
    }
    if (event.key === 'Enter' && highlightIndex >= 0) {
      const entry = suggestions[highlightIndex];
      if (entry) {
        event.preventDefault();
        applyCatalogEntry(entry);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setCatalogOpen(false);
      setHighlightIndex(-1);
    }
  }

  function toDraft(): ModelConfigurationDraft {
    return {
      id: modelId,
      label,
      contextWindow,
      maxOutputTokens,
      tooltipMarkdown: groupName,
      thinkingLevel: '',
      thinkingLevels: [],
      supportsImage,
      supportsImageGeneration: imageGeneration,
      supportsVideoGeneration: videoGeneration,
      supportsSpeechToText: speechToText,
      supportsTextToSpeech: textToSpeech,
      supportsNativeWebSearch: nativeWebSearch,
      reasoning,
      imageApiStyle,
      imagePath,
      imageTimeoutSeconds: imageGenTimeout,
      videoApiStyle,
      videoPath,
      videoTimeoutSeconds,
      videoPollIntervalSeconds,
    };
  }

  function applyRouteDraft(next: ModelConfigurationDraft): void {
    setImageApiStyle(next.imageApiStyle);
    setImagePath(next.imagePath);
    setImageGenTimeout(next.imageTimeoutSeconds);
    setVideoApiStyle(next.videoApiStyle);
    setVideoPath(next.videoPath);
    setVideoTimeoutSeconds(next.videoTimeoutSeconds);
    setVideoPollIntervalSeconds(next.videoPollIntervalSeconds);
  }

  function submit(): void {
    const id = modelId.trim();
    if (!id) {
      setError(isChinese ? '请填写模型 ID。' : 'Model ID is required.');
      return;
    }
    if (existingModelIds.includes(id)) {
      setError(isChinese ? '该模型 ID 已存在。' : 'This model ID already exists.');
      return;
    }
    const model = createModelConfigurationEntry(toDraft());
    if (!model) {
      setError(isChinese ? '请填写模型 ID。' : 'Model ID is required.');
      return;
    }
    onAdd(model);
    onOpenChange(false);
  }

  const showSuggestions = catalogOpen && suggestions.length > 0;

  return (
    <Modal
      title={copy.addModelTitle}
      open={open}
      onOpenChange={onOpenChange}
      testId="add-model-dialog"
      size="md"
      className="add-model-dialog"
    >
      <div ref={rootRef} className="add-model-dialog-body">
        <Field label={copy.modelId} required error={error}>
          <div className="add-model-id-combobox">
            <TextInput
              value={modelId}
              onChange={(event) => onModelIdChange(event.currentTarget.value)}
              onKeyDown={onModelIdKeyDown}
              placeholder={copy.modelIdPlaceholder}
              spellCheck={false}
              testId="add-model-id-input"
              autoFocus
              role="combobox"
              aria-expanded={showSuggestions}
              aria-controls={showSuggestions ? listboxId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={
                showSuggestions && highlightIndex >= 0
                  ? `${listboxId}-option-${highlightIndex}`
                  : undefined
              }
              onFocus={() => {
                if (suggestions.length > 0) setCatalogOpen(true);
              }}
            />
            {searching ? (
              <div
                className="add-model-catalog-status muted"
                data-testid="add-model-catalog-searching"
              >
                {isChinese ? '正在匹配模型目录…' : 'Searching model catalog…'}
              </div>
            ) : null}
            {showSuggestions ? (
              <ul
                id={listboxId}
                role="listbox"
                className="add-model-catalog-suggestions"
                data-testid="add-model-catalog-suggestions"
              >
                {suggestions.map((entry, index) => {
                  const active = index === highlightIndex;
                  return (
                    <li key={`${entry.catalogProviderId}:${entry.modelId}`} role="presentation">
                      <button
                        type="button"
                        id={`${listboxId}-option-${index}`}
                        role="option"
                        aria-selected={active}
                        className={
                          active ? 'add-model-catalog-option is-active' : 'add-model-catalog-option'
                        }
                        onMouseEnter={() => setHighlightIndex(index)}
                        onMouseDown={(event) => {
                          // Keep input focus; apply before blur closes the list.
                          event.preventDefault();
                          applyCatalogEntry(entry);
                        }}
                      >
                        <div className="add-model-catalog-option-id">{entry.modelId}</div>
                        <div className="add-model-catalog-option-meta muted">
                          <span>{entry.catalogProviderId}</span>
                          <span>
                            {formatTokenCount(entry.contextWindow)} ctx ·{' '}
                            {formatTokenCount(entry.maxTokens)} out
                          </span>
                          {entry.input.includes('image') ? <span>vision</span> : null}
                          {entry.reasoning ? <span>reasoning</span> : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </Field>
        <Field label={copy.modelDisplayName}>
          <TextInput
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
            placeholder={copy.modelNamePlaceholder}
            testId="add-model-label-input"
          />
        </Field>
        <Field label={copy.modelTooltipLabel}>
          <TextInput
            value={groupName}
            onChange={(event) => setGroupName(event.currentTarget.value)}
            placeholder={copy.modelTooltipPlaceholder}
            testId="add-model-tooltip-input"
          />
        </Field>
        <div className="add-model-limits-row">
          <div className="add-model-limits-col">
            <Field label={copy.contextLimit}>
              <TextInput
                value={contextWindow}
                onChange={(event) => setContextWindow(event.currentTarget.value)}
                placeholder="128000"
                spellCheck={false}
                testId="add-model-context-input"
              />
            </Field>
          </div>
          <div className="add-model-limits-col">
            <Field label={copy.outputLimit}>
              <TextInput
                value={maxOutputTokens}
                onChange={(event) => setMaxOutputTokens(event.currentTarget.value)}
                placeholder="16384"
                spellCheck={false}
                testId="add-model-output-input"
              />
            </Field>
          </div>
        </div>
        <div className="add-model-flags">
          <label className="add-model-flag">
            <input
              type="checkbox"
              checked={supportsImage}
              onChange={(event) => setSupportsImage(event.currentTarget.checked)}
              data-testid="add-model-supports-image"
            />
            {isChinese ? '支持图像输入（Vision）' : 'Supports image input (Vision)'}
          </label>
          <label className="add-model-flag">
            <input
              type="checkbox"
              checked={imageGeneration}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setImageGeneration(checked);
                applyRouteDraft(withImageGenerationEnabled(toDraft(), checked, protocol));
              }}
              data-testid="add-model-image-generation"
            />
            {isChinese ? '生图能力（Image Generation）' : 'Image generation'}
          </label>
          <label className="add-model-flag">
            <input
              type="checkbox"
              checked={videoGeneration}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setVideoGeneration(checked);
                applyRouteDraft(withVideoGenerationEnabled(toDraft(), checked, protocol));
              }}
              data-testid="add-model-video-generation"
            />
            {isChinese ? '视频生成（Video Generation）' : 'Video generation'}
          </label>
          <label className="add-model-flag">
            <input
              type="checkbox"
              checked={speechToText}
              onChange={(event) => setSpeechToText(event.currentTarget.checked)}
              data-testid="add-model-speech-to-text"
            />
            {isChinese ? '语音识别（ASR）' : 'Speech recognition (ASR)'}
          </label>
          <label className="add-model-flag">
            <input
              type="checkbox"
              checked={textToSpeech}
              onChange={(event) => setTextToSpeech(event.currentTarget.checked)}
              data-testid="add-model-text-to-speech"
            />
            {isChinese ? '语音合成（TTS）' : 'Speech synthesis (TTS)'}
          </label>
          <label className="add-model-flag">
            <input
              type="checkbox"
              checked={nativeWebSearch}
              onChange={(event) => setNativeWebSearch(event.currentTarget.checked)}
              data-testid="add-model-native-web-search"
            />
            {copy.nativeSearch}
          </label>
          <label className="add-model-flag">
            <input
              type="checkbox"
              checked={reasoning}
              onChange={(event) => setReasoning(event.currentTarget.checked)}
              data-testid="add-model-reasoning"
            />
            {isChinese ? '支持推理 / Thinking' : 'Supports reasoning / thinking'}
          </label>
        </div>
        <ModelGenerationRouteFields
          draft={toDraft()}
          isChinese={isChinese}
          onChange={(update) => applyRouteDraft(update(toDraft()))}
        />
        {searchCatalog ? (
          <p className="add-model-catalog-hint muted">
            {isChinese
              ? '输入模型 ID 前缀（≥2 字符）可从内置目录联想，并自动带出上下文窗口与最大输出。'
              : 'Type a model ID prefix (≥2 chars) to search the built-in catalog and auto-fill context / max output.'}
          </p>
        ) : null}
      </div>
      <div className="add-model-dialog-actions">
        <Button onClick={() => onOpenChange(false)}>{common.cancel}</Button>
        <Button variant="primary" onClick={submit} data-testid="add-model-submit">
          {copy.addModelAction}
        </Button>
      </div>
    </Modal>
  );
}
