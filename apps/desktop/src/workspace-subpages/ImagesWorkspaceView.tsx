import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, Select } from '@piwin/ui-kit';
import { IconChat, IconImage, IconRefresh, IconSpark } from '../shell-icons';
import type { DesktopLocale } from '../desktop-locale';
import {
  DEMO_IMAGES,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_STYLE,
  IMAGE_ASPECT_RATIOS,
  IMAGE_INSPIRATIONS,
  IMAGE_MODELS,
  IMAGE_STYLES,
  randomImageInspiration,
  type GeneratedImageItem,
  type ImageAspectRatio,
  type ImageInspiration,
} from './studio/gallery-models';
import {
  PillButton,
  PillGroup,
  RailField,
  RailSection,
  StudioRail,
  StudioTopbar,
} from './studio/studio-chrome';
import { MediaGalleryCard } from './studio/media-gallery-card';
import { MediaLightbox } from './studio/media-lightbox';
import { useLocalMediaSrc } from './studio/use-local-media-src';

export type { GeneratedImageItem } from './studio/gallery-models';

export type ImagesWorkspaceViewProps = {
  locale?: DesktopLocale;
  onClose: () => void;
  onSendToChat?: (text: string) => void;
  /** Library source; defaults to the demo dataset until host-backed media listing lands. */
  initialImages?: GeneratedImageItem[];
};

const PLACEHOLDER_RESULT =
  'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=800&q=80';

function resolutionFor(ratio: ImageAspectRatio): string {
  if (ratio === '16:9') return '1920x1080';
  if (ratio === '9:16') return '1080x1920';
  if (ratio === '4:3') return '1440x1080';
  if (ratio === '3:2') return '1536x1024';
  return '1024x1024';
}

/** Images studio: left rail owns creation + filters, the canvas is the library. */
export function ImagesWorkspaceView(props: ImagesWorkspaceViewProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState<ImageAspectRatio>('1:1');
  const [style, setStyle] = useState<string>(DEFAULT_IMAGE_STYLE);
  const [model, setModel] = useState<string>(DEFAULT_IMAGE_MODEL);
  const [search, setSearch] = useState('');
  const [ratioFilter, setRatioFilter] = useState<'all' | ImageAspectRatio>('all');
  const [density, setDensity] = useState<'dense' | 'standard' | 'large'>('standard');
  const [images, setImages] = useState<GeneratedImageItem[]>(props.initialImages ?? DEMO_IMAGES);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const resolveSrc = useLocalMediaSrc();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return images.filter((img) => {
      const matchRatio = ratioFilter === 'all' || img.aspectRatio === ratioFilter;
      const matchSearch =
        q === '' ||
        img.prompt.toLowerCase().includes(q) ||
        img.style.toLowerCase().includes(q) ||
        img.model.toLowerCase().includes(q);
      return matchRatio && matchSearch;
    });
  }, [images, search, ratioFilter]);

  const lightboxItem = images.find((img) => img.id === lightboxId) ?? null;

  const copyPrompt = useCallback((text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
  }, []);

  /** Real path: hand the composed command to the chat agent (toolbox image_gen). */
  const sendToChat = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      props.onSendToChat?.(`/image ${text.trim()} --ar ${ratio} --style ${style} --model ${model}`);
      props.onClose();
    },
    [props, ratio, style, model],
  );

  /**
   * Local preview generation — placeholder result only. The real pipeline is
   * the chat path above until the media slice lands.
   */
  const generateLocally = useCallback(() => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    window.setTimeout(() => {
      const item: GeneratedImageItem = {
        id: `img-${Date.now()}`,
        url: PLACEHOLDER_RESULT,
        prompt: prompt.trim(),
        aspectRatio: ratio,
        style,
        model,
        resolution: resolutionFor(ratio),
        createdAt: t('just now', '刚刚'),
      };
      setImages((prev) => [item, ...prev]);
      setGenerating(false);
    }, 900);
  }, [prompt, generating, ratio, style, model, t]);

  const applyInspiration = useCallback((insp: ImageInspiration) => {
    setPrompt(insp.prompt);
    setRatio(insp.ratio);
    setStyle(insp.style);
  }, []);

  const enhancePrompt = useCallback(() => {
    setPrompt((prev) =>
      prev.trim() === ''
        ? 'Ultra-detailed portrait with cinematic volumetric rim lighting, shot on 85mm f/1.2 lens, photorealistic skin shaders'
        : `${prev.trim()}, highly detailed, cinematic studio lighting`,
    );
  }, []);

  const deleteImage = useCallback(
    (id: string) => {
      setImages((prev) => prev.filter((img) => img.id !== id));
      setLightboxId((prev) => (prev === id ? null : prev));
    },
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (lightboxId !== null) {
          setLightboxId(null);
        } else {
          props.onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxId, props]);

  return (
    <div className="studio-stage" data-testid="images-workspace">
      <StudioTopbar
        testId="images-back-btn"
        backLabel={t('Chat', '会话')}
        onBack={props.onClose}
        icon={<IconImage width={15} height={15} />}
        title={t('Images Studio', '图片工作室')}
        countLabel={`${filtered.length}`}
        searchPlaceholder={t('Search prompts, styles…', '搜索提示词、风格…')}
        searchValue={search}
        onSearchChange={setSearch}
        actions={
          <div className="studio-density" role="group" aria-label={t('Density', '密度')}>
            {(['dense', 'standard', 'large'] as const).map((mode) => (
              <PillButton
                key={mode}
                active={density === mode}
                onClick={() => setDensity(mode)}
                title={
                  mode === 'dense'
                    ? t('Dense', '紧凑')
                    : mode === 'standard'
                      ? t('Standard', '标准')
                      : t('Large', '大图')
                }
              >
                {mode === 'dense' ? '⊞' : mode === 'standard' ? '▦' : '▣'}
              </PillButton>
            ))}
          </div>
        }
      />

      <div className="studio-body">
        <StudioRail>
          <RailSection title={t('Create', '创作')}>
            <textarea
              className="rail-prompt-input"
              data-testid="images-prompt-input"
              placeholder={t(
                'Describe the image: subject, lighting, mood, lens…',
                '描述画面：主体、光影、氛围、镜头…',
              )}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  generateLocally();
                }
              }}
            />
            <RailField label={t('Aspect ratio', '画幅')}>
              <PillGroup>
                {IMAGE_ASPECT_RATIOS.map((r) => (
                  <PillButton key={r} active={ratio === r} onClick={() => setRatio(r)}>
                    {r}
                  </PillButton>
                ))}
              </PillGroup>
            </RailField>
            <RailField label={t('Style', '风格')}>
              <Select
                value={style}
                onChange={(e) => setStyle(e.currentTarget.value)}
                data={[...IMAGE_STYLES.map((s) => ({ value: s.value, label: isZh ? s.labelZh : s.labelEn }))]}
              />
            </RailField>
            <RailField label={t('Model', '模型')}>
              <Select
                value={model}
                onChange={(e) => setModel(e.currentTarget.value)}
                data={IMAGE_MODELS.map((m) => ({ value: m.value, label: m.label }))}
              />
            </RailField>
            <div className="rail-actions">
              <Button
                variant="primary"
                size="compact"
                onClick={generateLocally}
                disabled={!prompt.trim() || generating}
              >
                <IconSpark width={13} height={13} />
                <span>{generating ? t('Generating…', '生成中…') : t('Generate', '立即生成')}</span>
              </Button>
              <Button
                variant="secondary"
                size="compact"
                onClick={() => sendToChat(prompt)}
                disabled={!prompt.trim()}
              >
                <IconChat width={13} height={13} />
                <span>{t('In Chat', '在会话生成')}</span>
              </Button>
              <div className="rail-actions-row">
                <Button variant="ghost" size="compact" onClick={enhancePrompt}>
                  <IconSpark width={13} height={13} />
                  <span>{t('Enhance', '润色')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => applyInspiration(randomImageInspiration())}
                >
                  <IconRefresh width={13} height={13} />
                  <span>{t('Inspire me', '灵感')}</span>
                </Button>
              </div>
            </div>
          </RailSection>

          <RailSection title={t('Library filter', '资源库筛选')}>
            <PillGroup>
              <PillButton active={ratioFilter === 'all'} onClick={() => setRatioFilter('all')}>
                {t('All', '全部')}
              </PillButton>
              {IMAGE_ASPECT_RATIOS.map((r) => (
                <PillButton key={r} active={ratioFilter === r} onClick={() => setRatioFilter(r)}>
                  {r}
                </PillButton>
              ))}
            </PillGroup>
          </RailSection>
        </StudioRail>

        <main className="studio-canvas">
          {filtered.length > 0 ? (
            <div className={`media-grid density-${density}`}>
              {filtered.map((img) => (
                <MediaGalleryCard
                  key={img.id}
                  item={{
                    id: img.id,
                    testId: `image-card-${img.id}`,
                    imageUrl: img.localPath !== undefined ? resolveSrc(img.localPath, img.url) : img.url,
                    alt: img.prompt,
                    aspectClass: `ratio-${img.aspectRatio.replace(':', '-')}`,
                    badgeTopLeft: img.aspectRatio,
                    badgeTopRight: img.style,
                    metaPrimary: img.model,
                    metaSecondary: img.createdAt,
                  }}
                  actions={{
                    copied: copiedId === img.id,
                    onOpen: () => setLightboxId(img.id),
                    onCopyPrompt: () => copyPrompt(img.prompt, img.id),
                    onRemixInChat: () => sendToChat(img.prompt),
                    onDelete: () => deleteImage(img.id),
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="media-empty">
              <div className="media-empty-icon">
                <IconImage width={28} height={28} />
              </div>
              <h2>{t('Nothing here yet', '还没有符合条件的图片')}</h2>
              <p>
                {t(
                  'Start from an inspiration template below, or compose your own prompt in the rail.',
                  '从下方灵感模板开始，或在左侧创作栏写下你的提示词。',
                )}
              </p>
              <div className="media-inspiration-grid">
                {IMAGE_INSPIRATIONS.map((insp) => (
                  <button
                    key={insp.tag}
                    type="button"
                    className="media-inspiration-card"
                    onClick={() => applyInspiration(insp)}
                  >
                    <span className="media-inspiration-tag">{isZh ? insp.tagZh : insp.tag}</span>
                    <span className="media-inspiration-prompt">{insp.prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {lightboxItem !== null && (
        <MediaLightbox
          testId="images-lightbox"
          title={t('Image details', '图片详情')}
          onClose={() => setLightboxId(null)}
          media={
            <img
              src={
                lightboxItem.localPath !== undefined
                  ? resolveSrc(lightboxItem.localPath, lightboxItem.url)
                  : lightboxItem.url
              }
              alt={lightboxItem.prompt}
            />
          }
          promptLabel={t('PROMPT', '提示词')}
          prompt={lightboxItem.prompt}
          stats={[
            { label: t('Ratio', '画幅'), value: lightboxItem.aspectRatio },
            { label: t('Resolution', '分辨率'), value: lightboxItem.resolution },
            { label: t('Model', '模型'), value: lightboxItem.model },
            { label: t('Style', '风格'), value: lightboxItem.style },
          ]}
          copyLabel={t('Copy prompt', '复制提示词')}
          copiedLabel={t('Copied', '已复制')}
          remixLabel={t('Remix in chat', '在会话中微调')}
          deleteLabel={t('Delete image', '删除图片')}
          copied={copiedId === lightboxItem.id}
          onCopyPrompt={() => copyPrompt(lightboxItem.prompt, lightboxItem.id)}
          onRemixInChat={() => sendToChat(lightboxItem.prompt)}
          onDelete={() => deleteImage(lightboxItem.id)}
        />
      )}
    </div>
  );
}
