/**
 * Estimate intrinsic pixel height for a native SVG fence from attributes /
 * viewBox. Used when the sandboxed height bridge is silent (e.g. packaged
 * Tauri WebView where postMessage WindowProxy identity diverges).
 */
import {
  INITIAL_ARTIFACT_IFRAME_HEIGHT,
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  MIN_ARTIFACT_IFRAME_HEIGHT,
} from './constants.js';

const VIEW_BOX_PATTERN =
  /viewBox\s*=\s*["']\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*[,\s]\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*[,\s]\s*([+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*[,\s]\s*([+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*["']/i;

const ATTR_SIZE_PATTERN =
  /\b(width|height)\s*=\s*["']?\s*([+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(px)?\s*["']?/gi;

export type EstimateSvgFenceHeightInput = {
  source: string;
  /** Available content width for the iframe stage (CSS px). */
  containerWidth: number;
  minHeight?: number;
  maxHeight?: number;
  /** Fallback when no geometry can be parsed. */
  fallbackHeight?: number;
};

/**
 * Parse width/height from a bare SVG root (attributes or viewBox aspect).
 * Returns null when the source is not SVG-like or has no usable geometry.
 */
export function parseSvgFenceIntrinsicSize(source: string): {
  width: number;
  height: number;
} | null {
  const trimmed = source.trim();
  if (!trimmed || !/<svg\b/i.test(trimmed)) {
    return null;
  }

  // Prefer the first <svg ...> open tag only — nested svg is rare for fences.
  const openTagMatch = trimmed.match(/<svg\b[^>]*>/i);
  const openTag = openTagMatch?.[0] ?? trimmed.slice(0, Math.min(trimmed.length, 2_000));

  let attrWidth: number | undefined;
  let attrHeight: number | undefined;
  ATTR_SIZE_PATTERN.lastIndex = 0;
  for (const match of openTag.matchAll(ATTR_SIZE_PATTERN)) {
    const name = match[1]?.toLowerCase();
    const value = Number(match[2]);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    if (name === 'width') {
      attrWidth = value;
    } else if (name === 'height') {
      attrHeight = value;
    }
  }

  if (attrWidth !== undefined && attrHeight !== undefined) {
    return { width: attrWidth, height: attrHeight };
  }

  const viewBox = openTag.match(VIEW_BOX_PATTERN);
  if (viewBox) {
    const vbWidth = Number(viewBox[3]);
    const vbHeight = Number(viewBox[4]);
    if (Number.isFinite(vbWidth) && Number.isFinite(vbHeight) && vbWidth > 0 && vbHeight > 0) {
      if (attrWidth !== undefined) {
        return { width: attrWidth, height: (attrWidth * vbHeight) / vbWidth };
      }
      if (attrHeight !== undefined) {
        return { width: (attrHeight * vbWidth) / vbHeight, height: attrHeight };
      }
      return { width: vbWidth, height: vbHeight };
    }
  }

  if (attrHeight !== undefined) {
    return { width: attrWidth ?? attrHeight, height: attrHeight };
  }
  if (attrWidth !== undefined) {
    // Common model default: square-ish when only width is declared.
    return { width: attrWidth, height: attrWidth };
  }
  return null;
}

/**
 * Map SVG intrinsic size onto the chat column width (object-fit contain).
 * Adds a small vertical pad for the artifact root's 4px padding.
 */
export function estimateSvgFenceHeight(input: EstimateSvgFenceHeightInput): number {
  const minHeight = input.minHeight ?? MIN_ARTIFACT_IFRAME_HEIGHT;
  const maxHeight = input.maxHeight ?? MAX_ARTIFACT_INLINE_FLOW_HEIGHT;
  const fallback = input.fallbackHeight ?? INITIAL_ARTIFACT_IFRAME_HEIGHT;
  const containerWidth = Math.max(1, input.containerWidth);

  const intrinsic = parseSvgFenceIntrinsicSize(input.source);
  if (!intrinsic) {
    return Math.min(maxHeight, Math.max(minHeight, fallback));
  }

  const scaledHeight = (containerWidth * intrinsic.height) / intrinsic.width;
  // Root padding (4px top + 4px bottom) from srcdoc shell.
  const withPad = Math.ceil(scaledHeight + 8);
  return Math.min(maxHeight, Math.max(minHeight, withPad));
}
