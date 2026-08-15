/**
 * Image-model suggestion combobox for the Image Generation settings page.
 *
 * Strictly sources from Piwin's own configured provider models (provider.models).
 * - Default view: ONLY displays enabled models with the image-generation capability.
 * - View all: expands to display ALL enabled models of the provider (deduplicated).
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { isModelEnabled, type ModelConfigEntry, type ModelProviderConfig } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context.js';
import { isImageGenerationModel } from './ImageGenerationSettings.js';

export type ImageModelSuggestProps = {
  value: string;
  onChange: (value: string) => void;
  provider: ModelProviderConfig | null;
  disabled?: boolean;
};

export function ImageModelSuggest(props: ImageModelSuggestProps): ReactElement {
  const { value, onChange, provider, disabled } = props;
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const listboxId = useId();

  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Extract all enabled and deduplicated models from the current provider.
  const providerModels = useMemo(() => {
    if (!provider?.models) return [];
    const seen = new Set<string>();
    const list: ModelConfigEntry[] = [];
    for (const model of provider.models) {
      if (!isModelEnabled(model)) continue;
      const id = model.id.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      list.push(model);
    }
    return list;
  }, [provider]);

  // Image-capable models only.
  const imageModels = useMemo(
    () => providerModels.filter((model) => isImageGenerationModel(model)),
    [providerModels],
  );

  // Reset showAll when provider changes.
  useEffect(() => {
    setShowAll(false);
  }, [provider?.id]);

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

  // Filter based on input query.
  const queryLower = value.trim().toLowerCase();

  const filteredImageModels = useMemo(() => {
    if (!queryLower) return imageModels;
    return imageModels.filter(
      (m) =>
        m.id.toLowerCase().includes(queryLower) ||
        (m.label ? m.label.toLowerCase().includes(queryLower) : false),
    );
  }, [imageModels, queryLower]);

  const filteredAllModels = useMemo(() => {
    if (!queryLower) return providerModels;
    return providerModels.filter(
      (m) =>
        m.id.toLowerCase().includes(queryLower) ||
        (m.label ? m.label.toLowerCase().includes(queryLower) : false),
    );
  }, [providerModels, queryLower]);

  const allVisible = showAll ? filteredAllModels : filteredImageModels;

  // Reset highlight index when list changes.
  useEffect(() => {
    setHighlightIndex(allVisible.length > 0 ? 0 : -1);
  }, [allVisible.length, showAll, value]);

  function selectItem(model: ModelConfigEntry): void {
    onChange(model.id);
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
        placeholder: '输入或选择生图模型 ID',
        noImageModels: '当前渠道暂无生图模型，可点击下方「查看全部」或手动输入',
        noModels: '当前渠道暂无已配置的模型，可在「通道与文本」中拉取或手动输入',
        noMatch: '未找到匹配的模型',
        showAll: `查看全部渠道模型（${providerModels.length}）`,
        showOnlyImage: `仅看生图模型（${imageModels.length}）`,
        image: '生图',
        video: '视频',
        chat: '对话',
      }
    : {
        placeholder: 'Enter or select image model ID',
        noImageModels: 'No image models on this channel — click View all or type an ID',
        noModels: 'No models configured on this channel — fetch models under Channels & chat or type an ID',
        noMatch: 'No matching models found',
        showAll: `View all channel models (${providerModels.length})`,
        showOnlyImage: `Show only image models (${imageModels.length})`,
        image: 'Image',
        video: 'Video',
        chat: 'Chat',
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
          {allVisible.length === 0 ? (
            <p className="image-model-suggest-empty muted">
              {providerModels.length === 0
                ? t.noModels
                : !showAll && imageModels.length === 0
                  ? t.noImageModels
                  : t.noMatch}
            </p>
          ) : (
            <ul
              id={listboxId}
              role="listbox"
              className="image-model-suggest-list"
              data-testid="image-model-suggest-list"
            >
              {allVisible.map((model, index) => {
                const active = index === highlightIndex;
                const isImage = isImageGenerationModel(model);
                const isVideo = model.capabilities?.includes('video-generation');
                const isChat = model.capabilities?.includes('chat');
                const badgeLabel = isImage ? t.image : isVideo ? t.video : isChat ? t.chat : null;

                return (
                  <li key={model.id} role="presentation">
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
                        selectItem(model);
                      }}
                    >
                      <div className="image-model-suggest-option-id">
                        {model.id}
                      </div>
                      <div className="image-model-suggest-option-meta muted">
                        {model.label && model.label !== model.id ? (
                          <span>{model.label}</span>
                        ) : null}
                        {badgeLabel ? (
                          <span className="image-model-suggest-badge">{badgeLabel}</span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {providerModels.length > 0 && (
            <button
              type="button"
              className="image-model-suggest-show-all"
              data-testid="image-model-suggest-show-all"
              onClick={() => setShowAll((prev) => !prev)}
            >
              {showAll ? t.showOnlyImage : t.showAll}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
