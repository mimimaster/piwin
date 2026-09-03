/**
 * In-memory LRU for rendered Mermaid SVGs and measured heights.
 *
 * Session switch remounts every fence. Without this, each diagram starts at a
 * ~17px "Rendering diagram…" placeholder and then grows as mermaid.render
 * finishes one-by-one — the transcript stick-to-bottom observer jumps on
 * every growth. Cached SVGs paint at full size on the first frame; remembered
 * heights reserve the placeholder when the SVG has been evicted.
 */
import type { ThemeMode } from './theme/theme-mode.js';

export const MAX_MERMAID_DIAGRAM_SVG_CACHE_ENTRIES = 64;
export const MAX_MERMAID_DIAGRAM_HEIGHT_CACHE_ENTRIES = 256;
export const MERMAID_DIAGRAM_MIN_CACHED_HEIGHT_PX = 40;
export const MERMAID_DIAGRAM_MAX_CACHED_HEIGHT_PX = 4_000;

const svgByKey = new Map<string, string>();
const heightPxByKey = new Map<string, number>();
const inflightSvgByKey = new Map<string, Promise<string>>();

function mermaidDiagramCacheKey(source: string, themeMode: ThemeMode): string {
  return `${themeMode}\0${source}`;
}

function readLruEntry<T>(map: Map<string, T>, key: string): T | undefined {
  const value = map.get(key);
  if (value === undefined) {
    return undefined;
  }
  map.delete(key);
  map.set(key, value);
  return value;
}

function writeLruEntry<T>(
  map: Map<string, T>,
  key: string,
  value: T,
  maxEntries: number,
): void {
  map.delete(key);
  map.set(key, value);
  const oldestKey = map.keys().next().value;
  if (map.size > maxEntries && oldestKey !== undefined) {
    map.delete(oldestKey);
  }
}

export function readMermaidDiagramSvg(source: string, themeMode: ThemeMode): string | null {
  return readLruEntry(svgByKey, mermaidDiagramCacheKey(source, themeMode)) ?? null;
}

export function rememberMermaidDiagramSvg(
  source: string,
  themeMode: ThemeMode,
  svg: string,
): void {
  writeLruEntry(
    svgByKey,
    mermaidDiagramCacheKey(source, themeMode),
    svg,
    MAX_MERMAID_DIAGRAM_SVG_CACHE_ENTRIES,
  );
}

export function readMermaidDiagramHeight(
  source: string,
  themeMode: ThemeMode,
): number | null {
  return readLruEntry(heightPxByKey, mermaidDiagramCacheKey(source, themeMode)) ?? null;
}

export function rememberMermaidDiagramHeight(
  source: string,
  themeMode: ThemeMode,
  heightPx: number,
): void {
  if (!Number.isFinite(heightPx) || heightPx < MERMAID_DIAGRAM_MIN_CACHED_HEIGHT_PX / 2) {
    return;
  }
  const clamped = Math.min(MERMAID_DIAGRAM_MAX_CACHED_HEIGHT_PX, Math.ceil(heightPx));
  if (clamped < MERMAID_DIAGRAM_MIN_CACHED_HEIGHT_PX / 2) {
    return;
  }
  writeLruEntry(
    heightPxByKey,
    mermaidDiagramCacheKey(source, themeMode),
    Math.max(MERMAID_DIAGRAM_MIN_CACHED_HEIGHT_PX, clamped),
    MAX_MERMAID_DIAGRAM_HEIGHT_CACHE_ENTRIES,
  );
}

/**
 * Return a cached SVG, join an in-flight render, or start `render`.
 * Successful renders are stored even if the calling component unmounted —
 * the next mount should paint at full size without calling mermaid again.
 */
export function getOrCreateMermaidDiagramRender(
  source: string,
  themeMode: ThemeMode,
  render: () => Promise<string>,
): Promise<string> {
  const cachedSvg = readMermaidDiagramSvg(source, themeMode);
  if (cachedSvg !== null) {
    return Promise.resolve(cachedSvg);
  }
  const key = mermaidDiagramCacheKey(source, themeMode);
  const inflight = inflightSvgByKey.get(key);
  if (inflight) {
    return inflight;
  }
  const pending = render()
    .then((svg) => {
      rememberMermaidDiagramSvg(source, themeMode, svg);
      return svg;
    })
    .finally(() => {
      if (inflightSvgByKey.get(key) === pending) {
        inflightSvgByKey.delete(key);
      }
    });
  inflightSvgByKey.set(key, pending);
  return pending;
}

export function clearMermaidDiagramCacheForTests(): void {
  svgByKey.clear();
  heightPxByKey.clear();
  inflightSvgByKey.clear();
}
