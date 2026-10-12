import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Image,
  deleteAllKittyImages,
  getCapabilities,
  setCapabilities,
  hyperlink,
  type ImageProtocol,
} from '@earendil-works/pi-tui';
import type { MediaReadData } from '@piwin/contracts';
import type { TranscriptImage, TranscriptState } from './transcript-model.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import { style } from './tui-style.js';

/**
 * Images in the transcript. A terminal that speaks kitty or iTerm2 graphics
 * draws them inline (at most 40×12 cells); anything else, tmux, or
 * `PIWIN_IMAGES=off` gets one placeholder line. Bytes are read from the Host
 * only when a row is drawn, and kept.
 */

export const IMAGE_MAX_COLS = 40;
export const IMAGE_MAX_ROWS = 12;
/** Larger originals are left as a placeholder rather than pulled across the link. */
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export type ImageMode = 'kitty' | 'iterm2' | 'off';
export type ImageSetting = 'auto' | 'off' | 'kitty' | 'iterm2';

export function parseImageSetting(value: string | undefined): ImageSetting {
  const lowered = (value ?? '').trim().toLowerCase();
  return lowered === 'off' || lowered === 'kitty' || lowered === 'iterm2' ? lowered : 'auto';
}

/** Explicit settings win; `auto` follows the terminal and stays off under tmux, which drops graphics. */
export function resolveImageMode(
  setting: ImageSetting,
  env: NodeJS.ProcessEnv,
  detected: ImageProtocol,
): ImageMode {
  if (setting !== 'auto') return setting;
  if ((env.TMUX ?? '') !== '' || (env.TERM ?? '').startsWith('screen') || (env.TERM ?? '').startsWith('tmux')) return 'off';
  return detected ?? 'off';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** `🖼 name · PNG 800×600 · 120 KB`, linked to the Host file when there is a path. */
export function imagePlaceholder(image: TranscriptImage, note?: string): string {
  const format = (image.mimeType.split('/')[1] ?? 'image').toUpperCase().replace('JPEG', 'JPG').replace('SVG+XML', 'SVG');
  const size = image.width !== undefined && image.height !== undefined ? ` ${image.width}×${image.height}` : '';
  const parts = [
    image.name ?? image.id,
    `${format}${size}`,
    ...(image.byteSize === undefined ? [] : [formatBytes(image.byteSize)]),
    ...(note === undefined ? [] : [note]),
  ];
  const label = `🖼 ${parts.join(' · ')}`;
  return image.path !== undefined && image.path.startsWith('/') ? hyperlink(label, `file://${encodeURI(image.path)}`) : label;
}

type Loaded = { status: 'loading' } | { status: 'ready'; base64: string; mimeType: string } | { status: 'failed' };

export type TuiImageStoreOptions = {
  link: TuiHostLink;
  getSessionId: () => string | undefined;
  /** A picture arrived: redraw the transcript. */
  onLoaded: () => void;
  write: (data: string) => void;
  env?: NodeJS.ProcessEnv;
  /** Override for tests; defaults to pi-tui's detection. */
  detect?: () => ImageProtocol;
};

export class TuiImageStore {
  private readonly loaded = new Map<string, Loaded>();
  private readonly components = new Map<string, Image>();
  private setting: ImageSetting;
  /** `/images` turns inline drawing off for this shell, or back to the setting. */
  private disabled = false;

  public constructor(private readonly options: TuiImageStoreOptions) {
    this.setting = parseImageSetting((options.env ?? process.env).PIWIN_IMAGES);
    // A forced protocol (Desktop's embedded xterm sets PIWIN_IMAGES=iterm2) must be in
    // pi-tui's capabilities before the TUI starts: that is when it asks the terminal for
    // its cell size (CSI 16 t), which sizes every picture. pi-tui's own detection
    // returns nothing inside xterm.js.
    if ((this.setting === 'kitty' || this.setting === 'iterm2') && options.detect === undefined) {
      setCapabilities({ ...getCapabilities(), images: this.setting });
    }
  }

  public mode(): ImageMode {
    if (this.disabled) return 'off';
    const detected = (this.options.detect ?? (() => getCapabilities().images))();
    return resolveImageMode(this.setting, this.options.env ?? process.env, detected);
  }

  /** `/images`: flip between inline pictures and placeholders. Returns the hint to show. */
  public toggle(): string {
    this.disabled = !this.disabled;
    this.clearScreenImages();
    const mode = this.mode();
    if (this.disabled) return '图片：只显示占位行';
    return mode === 'off' ? '图片：这个终端不支持内联显示（或在 tmux 里），仍显示占位行' : `图片：内联显示（${mode}）`;
  }

  /** Lines for a turn's images. */
  public render(images: readonly TranscriptImage[], width: number): string[] {
    const mode = this.mode();
    // pi-tui's Image reads the shared capabilities; a forced protocol has to reach it.
    if (mode !== 'off' && getCapabilities().images !== mode) setCapabilities({ ...getCapabilities(), images: mode });
    return images.flatMap((image) => {
      if (mode === 'off') return [` ${style.gray('⎿ ')}${imagePlaceholder(image)}`];
      const state = this.loaded.get(image.id);
      if (state === undefined) this.load(image);
      if (state?.status !== 'ready') {
        const note = state?.status === 'failed' ? '无法读取' : '加载中…';
        return [` ${style.gray('⎿ ')}${imagePlaceholder(image, note)}`];
      }
      let component = this.components.get(image.id);
      if (component === undefined) {
        component = new Image(
          state.base64,
          state.mimeType,
          { fallbackColor: style.gray },
          { maxWidthCells: IMAGE_MAX_COLS, maxHeightCells: IMAGE_MAX_ROWS, ...(image.name ? { filename: image.name } : {}) },
          image.width !== undefined && image.height !== undefined
            ? { widthPx: image.width, heightPx: image.height }
            : undefined,
        );
        this.components.set(image.id, component);
      }
      return [...component.render(Math.max(1, width - 3)).map((line) => `   ${line}`), ` ${style.gray('⎿ ')}${imagePlaceholder(image)}`];
    });
  }

  /** Bytes for one image (cached), for drawing or opening. */
  public async read(image: TranscriptImage): Promise<{ base64: string; mimeType: string } | undefined> {
    const cached = this.loaded.get(image.id);
    if (cached?.status === 'ready') return cached;
    const sessionId = this.options.getSessionId();
    if (sessionId === undefined) return undefined;
    this.loaded.set(image.id, { status: 'loading' });
    try {
      const data = hostData<MediaReadData>(
        await this.options.link.request({
          type: 'media/read',
          input: { sessionId, assetId: image.id, maxBytes: IMAGE_MAX_BYTES },
        }),
      );
      if (data.status !== 'ready') throw new Error(data.reason);
      const ready = { status: 'ready' as const, base64: data.base64Data, mimeType: data.mimeType || image.mimeType };
      this.loaded.set(image.id, ready);
      return ready;
    } catch {
      this.loaded.set(image.id, { status: 'failed' });
      return undefined;
    }
  }

  private load(image: TranscriptImage): void {
    void this.read(image).then(() => this.options.onLoaded());
  }

  /** Session switch: forget bytes and pictures already placed on screen. */
  public reset(): void {
    this.loaded.clear();
    this.clearScreenImages();
  }

  /** Kitty keeps placed pictures across redraws; remove them before the screen is redrawn or resized. */
  public clearScreenImages(): void {
    this.components.clear();
    if (this.mode() === 'kitty' || this.setting === 'kitty') this.options.write(deleteAllKittyImages());
  }
}

/** The newest image in the conversation: tool output or attachment, last first. */
export function latestImage(transcript: TranscriptState): TranscriptImage | undefined {
  for (let index = transcript.entries.length - 1; index >= 0; index -= 1) {
    const entry = transcript.entries[index];
    if (entry?.kind !== 'message') continue;
    for (let tool = entry.tools.length - 1; tool >= 0; tool -= 1) {
      const images = entry.tools[tool]?.images;
      if (images !== undefined && images.length > 0) return images.at(-1);
    }
    if (entry.images !== undefined && entry.images.length > 0) return entry.images.at(-1);
  }
  return undefined;
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
};

/** Write an image's bytes to a private temp file so the system viewer can open it. */
export async function writeImageTempFile(image: TranscriptImage, base64: string, mimeType: string): Promise<string> {
  const dir = join(tmpdir(), 'piwin-images');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const safeId = image.id.replace(/[^\w.-]/g, '_');
  const filePath = join(dir, `${safeId}.${EXTENSIONS[mimeType] ?? 'img'}`);
  await writeFile(filePath, Buffer.from(base64, 'base64'), { mode: 0o600 });
  return filePath;
}

/** Open the newest image with the system viewer, via a temp file. */
export async function openLatestImage(deps: {
  store: TuiImageStore;
  transcript: TranscriptState;
  open: (filePath: string) => Promise<void>;
  hint: (text: string) => void;
  notice: (tone: 'info' | 'error', text: string) => void;
}): Promise<void> {
  const image = latestImage(deps.transcript);
  if (image === undefined) {
    deps.hint('这段对话里还没有图片');
    return;
  }
  const bytes = await deps.store.read(image);
  if (bytes === undefined) {
    deps.notice('error', `读取不到图片「${image.name ?? image.id}」`);
    return;
  }
  const filePath = await writeImageTempFile(image, bytes.base64, bytes.mimeType);
  try {
    await deps.open(filePath);
    deps.hint(`已用系统查看器打开「${image.name ?? image.id}」`);
  } catch {
    deps.notice('info', `没能自动打开，图片已保存到：\n${filePath}`);
  }
}
