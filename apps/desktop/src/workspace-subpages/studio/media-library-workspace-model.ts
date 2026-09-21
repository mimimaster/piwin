import type { MediaLibraryFilter } from './use-media-library';

export type ActiveKind = 'all' | 'image' | 'video' | 'favorite';

/** The vault browses images and videos only; files are not a tab. */
export const KIND_TABS: Array<{
  id: ActiveKind;
  testId: string;
  en: string;
  zh: string;
}> = [
  { id: 'image', testId: 'library-tab-images', en: 'Images', zh: '图片' },
  { id: 'video', testId: 'library-tab-videos', en: 'Videos', zh: '视频' },
  { id: 'favorite', testId: 'library-tab-favorites', en: 'Favorites', zh: '收藏' },
];

export function kindFromInitial(kind: MediaLibraryFilter): ActiveKind {
  // `file` is no longer a browsable kind, so an initial file request opens Images.
  return kind === 'video' ? 'video' : 'image';
}

export const INSPIRATIONS = [
  {
    model: 'FLUX.1 Pro',
    title: '赛博朋克雨夜街道',
    prompt:
      'A cinematic hyper-realistic cyberpunk Tokyo street at rainy midnight, neon holographic reflections, 8k octane render.',
  },
  {
    model: 'Midjourney v6.1',
    title: '极简黑曜石发光 UI',
    prompt:
      'Futuristic spatial UI design on obsidian glass, glowing subtle indigo gradients, clean typography, minimalist modern.',
  },
  {
    model: 'Runway Gen-3',
    title: '未来流体超跑 (4K 视频)',
    prompt:
      'Dynamic fluid chrome hypercar accelerating through neon grid tunnel, particle trail explosion, cinematic 60fps slow motion.',
  },
  {
    model: 'DALL-E 3',
    title: '深空星云宇航员',
    prompt:
      'Astronaut standing on an asteroid looking at a massive swirling violet and cyan cosmic nebula, Hubble telescope quality.',
  },
];

export const DELETE_UNDO_WINDOW_MS = 6000;

export type ToastState = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

const FAVORITES_STORAGE_KEY = 'piwin.media_vault.favorites';

export function loadStoredFavorites(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveStoredFavorites(set: Set<string>): void {
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore storage write errors
  }
}

export const THUMB_FIT_STORAGE_KEY = 'piwin.media_vault.thumb_fit';
export type ThumbFit = 'cover' | 'contain';

export function loadStoredThumbFit(): ThumbFit {
  try {
    return window.localStorage.getItem(THUMB_FIT_STORAGE_KEY) === 'contain' ? 'contain' : 'cover';
  } catch {
    return 'cover';
  }
}
