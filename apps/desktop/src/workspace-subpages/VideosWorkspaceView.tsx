import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, SegmentedControl, Select } from '@piwin/ui-kit';
import { IconChat, IconRefresh, IconSpark, IconVideo } from '../shell-icons';
import type { DesktopLocale } from '../desktop-locale';
import {
  CAMERA_MOTIONS,
  DEFAULT_CAMERA_MOTION,
  DEFAULT_VIDEO_MODEL,
  DEMO_VIDEOS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_INSPIRATIONS,
  VIDEO_MODELS,
  randomVideoInspiration,
  type GeneratedVideoItem,
  type VideoAspectRatio,
  type VideoInspiration,
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

export type { GeneratedVideoItem } from './studio/gallery-models';

export type VideosWorkspaceViewProps = {
  locale?: DesktopLocale;
  onClose: () => void;
  onSendToChat?: (text: string) => void;
  /** Library source; defaults to the demo dataset until host-backed media listing lands. */
  initialVideos?: GeneratedVideoItem[];
};

const PLACEHOLDER_THUMB =
  'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=1200&q=80';
const PLACEHOLDER_VIDEO =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';

const VIDEO_MODES = [
  { value: 'text-to-video', labelEn: 'Text to Video', labelZh: '文生视频' },
  { value: 'image-to-video', labelEn: 'Image to Video', labelZh: '图生视频' },
  { value: 'remix', labelEn: 'Video Remix', labelZh: '风格重绘' },
] as const;

type VideoMode = (typeof VIDEO_MODES)[number]['value'];
type MotionStrength = GeneratedVideoItem['motionStrength'];

function resolutionFor(ratio: VideoAspectRatio): string {
  if (ratio === '16:9') return '1920x1080';
  if (ratio === '9:16') return '1080x1920';
  return '1024x1024';
}

/** Videos studio: same rail/canvas skeleton as Images, motion-specific controls. */
export function VideosWorkspaceView(props: VideosWorkspaceViewProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<VideoMode>('text-to-video');
  const [duration, setDuration] = useState<3 | 5 | 10>(5);
  const [ratio, setRatio] = useState<VideoAspectRatio>('16:9');
  const [cameraMotion, setCameraMotion] = useState<string>(DEFAULT_CAMERA_MOTION);
  const [motionStrength, setMotionStrength] = useState<MotionStrength>('moderate');
  const [model, setModel] = useState<string>(DEFAULT_VIDEO_MODEL);
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | VideoMode>('all');
  const [videos, setVideos] = useState<GeneratedVideoItem[]>(props.initialVideos ?? DEMO_VIDEOS);
  const [theaterId, setTheaterId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const resolveSrc = useLocalMediaSrc();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return videos.filter((vid) => {
      const matchMode = modeFilter === 'all' || vid.mode === modeFilter;
      const matchSearch =
        q === '' ||
        vid.prompt.toLowerCase().includes(q) ||
        vid.cameraMotion.toLowerCase().includes(q) ||
        vid.model.toLowerCase().includes(q);
      return matchMode && matchSearch;
    });
  }, [videos, search, modeFilter]);

  const theaterItem = videos.find((vid) => vid.id === theaterId) ?? null;

  const copyPrompt = useCallback((text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
  }, []);

  const sendToChat = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      props.onSendToChat?.(
        `/video ${text.trim()} --mode ${mode} --duration ${duration}s --ar ${ratio} --camera "${cameraMotion}" --model ${model}`,
      );
      props.onClose();
    },
    [props, mode, duration, ratio, cameraMotion, model],
  );

  const generateLocally = useCallback(() => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    window.setTimeout(() => {
      const item: GeneratedVideoItem = {
        id: `vid-${Date.now()}`,
        thumbnailUrl: PLACEHOLDER_THUMB,
        videoUrl: PLACEHOLDER_VIDEO,
        prompt: prompt.trim(),
        mode,
        durationSeconds: duration,
        aspectRatio: ratio,
        cameraMotion,
        motionStrength,
        model,
        resolution: resolutionFor(ratio),
        createdAt: t('just now', '刚刚'),
      };
      setVideos((prev) => [item, ...prev]);
      setGenerating(false);
    }, 1100);
  }, [prompt, generating, mode, duration, ratio, cameraMotion, motionStrength, model, t]);

  const applyInspiration = useCallback((insp: VideoInspiration) => {
    setPrompt(insp.prompt);
    setCameraMotion(insp.cameraMotion);
    setDuration(insp.durationSeconds === 3 ? 3 : 5);
    setRatio(insp.ratio);
  }, []);

  const enhancePrompt = useCallback(() => {
    setPrompt((prev) =>
      prev.trim() === ''
        ? 'Cinematic drone shot sweeping through a neon city at night, rain reflections, volumetric fog, ultra-smooth motion'
        : `${prev.trim()}, cinematic composition, smooth camera tracking`,
    );
  }, []);

  const deleteVideo = useCallback((id: string) => {
    setVideos((prev) => prev.filter((vid) => vid.id !== id));
    setTheaterId((prev) => (prev === id ? null : prev));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (theaterId !== null) {
          setTheaterId(null);
        } else {
          props.onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [theaterId, props]);

  return (
    <div className="studio-stage" data-testid="videos-workspace">
      <StudioTopbar
        testId="videos-back-btn"
        backLabel={t('Chat', '会话')}
        onBack={props.onClose}
        icon={<IconVideo width={15} height={15} />}
        title={t('Videos Studio', '视频工作室')}
        countLabel={`${filtered.length}`}
        searchPlaceholder={t('Search prompts, motion…', '搜索提示词、运镜…')}
        searchValue={search}
        onSearchChange={setSearch}
      />

      <div className="studio-body">
        <StudioRail>
          <RailSection title={t('Create', '创作')}>
            <RailField label={t('Mode', '生成模式')}>
              <SegmentedControl
                size="xs"
                fullWidth
                value={mode}
                onChange={(value) => setMode(value as VideoMode)}
                data={VIDEO_MODES.map((m) => ({
                  value: m.value,
                  label: isZh ? m.labelZh : m.labelEn,
                }))}
              />
            </RailField>
            <textarea
              className="rail-prompt-input"
              data-testid="videos-prompt-input"
              placeholder={t(
                'Describe action, camera trajectory, dynamics…',
                '描述动态、镜头轨迹与主体动作…',
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
            <RailField label={t('Duration', '时长')}>
              <PillGroup>
                {([3, 5, 10] as const).map((d) => (
                  <PillButton key={d} active={duration === d} onClick={() => setDuration(d)}>
                    {d}s
                  </PillButton>
                ))}
              </PillGroup>
            </RailField>
            <RailField label={t('Aspect ratio', '画幅')}>
              <PillGroup>
                {VIDEO_ASPECT_RATIOS.map((r) => (
                  <PillButton key={r} active={ratio === r} onClick={() => setRatio(r)}>
                    {r}
                  </PillButton>
                ))}
              </PillGroup>
            </RailField>
            <RailField label={t('Camera motion', '运镜')}>
              <Select
                value={cameraMotion}
                onChange={(e) => setCameraMotion(e.currentTarget.value)}
                data={CAMERA_MOTIONS.map((c) => ({
                  value: c.value,
                  label: isZh ? `${c.en} (${c.zh})` : c.en,
                }))}
              />
            </RailField>
            <RailField label={t('Motion strength', '动感强度')}>
              <PillGroup>
                {(['subtle', 'moderate', 'dynamic'] as const).map((strength) => (
                  <PillButton
                    key={strength}
                    active={motionStrength === strength}
                    onClick={() => setMotionStrength(strength)}
                  >
                    {strength === 'subtle'
                      ? t('Subtle', '微动')
                      : strength === 'moderate'
                        ? t('Natural', '自然')
                        : t('Dynamic', '剧烈')}
                  </PillButton>
                ))}
              </PillGroup>
            </RailField>
            <RailField label={t('Model', '模型')}>
              <Select
                value={model}
                onChange={(e) => setModel(e.currentTarget.value)}
                data={VIDEO_MODELS.map((m) => ({ value: m.value, label: m.label }))}
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
                <span>{generating ? t('Rendering…', '渲染中…') : t('Generate video', '立即生成')}</span>
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
                <Button variant="ghost" size="compact" onClick={() => applyInspiration(randomVideoInspiration())}>
                  <IconRefresh width={13} height={13} />
                  <span>{t('Inspire me', '灵感')}</span>
                </Button>
              </div>
            </div>
          </RailSection>

          <RailSection title={t('Library filter', '资源库筛选')}>
            <PillGroup>
              <PillButton active={modeFilter === 'all'} onClick={() => setModeFilter('all')}>
                {t('All', '全部')}
              </PillButton>
              {VIDEO_MODES.filter((m) => m.value !== 'remix').map((m) => (
                <PillButton
                  key={m.value}
                  active={modeFilter === m.value}
                  onClick={() => setModeFilter(m.value)}
                >
                  {isZh ? m.labelZh : m.labelEn}
                </PillButton>
              ))}
            </PillGroup>
          </RailSection>
        </StudioRail>

        <main className="studio-canvas">
          {filtered.length > 0 ? (
            <div className="media-grid density-standard">
              {filtered.map((vid) => (
                <MediaGalleryCard
                  key={vid.id}
                  item={{
                    id: vid.id,
                    testId: `video-card-${vid.id}`,
                    imageUrl:
                      vid.localPath !== undefined
                        ? resolveSrc(vid.localPath, vid.thumbnailUrl)
                        : vid.thumbnailUrl,
                    alt: vid.prompt,
                    aspectClass: `ratio-${vid.aspectRatio.replace(':', '-')}`,
                    badgeTopLeft: `00:0${vid.durationSeconds}`,
                    badgeTopRight: vid.cameraMotion,
                    metaPrimary: vid.model,
                    metaSecondary: vid.createdAt,
                    showPlayOverlay: true,
                  }}
                  actions={{
                    copied: copiedId === vid.id,
                    onOpen: () => setTheaterId(vid.id),
                    onCopyPrompt: () => copyPrompt(vid.prompt, vid.id),
                    onRemixInChat: () => sendToChat(vid.prompt),
                    onDelete: () => deleteVideo(vid.id),
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="media-empty">
              <div className="media-empty-icon">
                <IconVideo width={28} height={28} />
              </div>
              <h2>{t('Nothing here yet', '还没有符合条件的视频')}</h2>
              <p>
                {t(
                  'Pick an inspiration preset below, or compose your own motion prompt in the rail.',
                  '从下方灵感案例开始，或在左侧创作栏写下你的运镜提示词。',
                )}
              </p>
              <div className="media-inspiration-grid">
                {VIDEO_INSPIRATIONS.map((insp) => (
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

      {theaterItem !== null && (
        <MediaLightbox
          testId="videos-theater"
          title={t('Video details', '视频详情')}
          onClose={() => setTheaterId(null)}
          media={
            <video
              src={
                theaterItem.localPath !== undefined
                  ? resolveSrc(theaterItem.localPath, theaterItem.videoUrl)
                  : theaterItem.videoUrl
              }
              poster={
                theaterItem.localPath !== undefined
                  ? resolveSrc(theaterItem.localPath, theaterItem.thumbnailUrl)
                  : theaterItem.thumbnailUrl
              }
              controls
              autoPlay
              loop
            />
          }
          promptLabel={t('MOTION PROMPT', '运镜提示词')}
          prompt={theaterItem.prompt}
          stats={[
            { label: t('Duration', '时长'), value: `${theaterItem.durationSeconds}s` },
            { label: t('Camera', '运镜'), value: theaterItem.cameraMotion },
            { label: t('Ratio', '画幅'), value: theaterItem.aspectRatio },
            { label: t('Model', '模型'), value: theaterItem.model },
          ]}
          copyLabel={t('Copy prompt', '复制提示词')}
          copiedLabel={t('Copied', '已复制')}
          remixLabel={t('Remix in chat', '在会话中重混')}
          deleteLabel={t('Delete video', '删除视频')}
          copied={copiedId === theaterItem.id}
          onCopyPrompt={() => copyPrompt(theaterItem.prompt, theaterItem.id)}
          onRemixInChat={() => sendToChat(theaterItem.prompt)}
          onDelete={() => deleteVideo(theaterItem.id)}
        />
      )}
    </div>
  );
}
