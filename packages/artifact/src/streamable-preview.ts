/**
 * Streamable preview builder for artifact HTML.
 * Safe incremental preview while the model is still streaming an unfinished fence.
 * Ported from openwebui_m artifactStreamablePreview — no script tails executed.
 */
import type { StreamablePreviewResult } from './types.js';

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const COMPLETE_SCRIPT_PATTERN = /<script\b[\s\S]*?<\/script\s*>/gi;
const TRAILING_INCOMPLETE_SCRIPT_PATTERN = /<script\b[\s\S]*$/i;
const TRAILING_INCOMPLETE_STYLE_PATTERN = /<style\b(?:(?!<\/style>).)*$/is;
const INLINE_EVENT_HANDLER_PATTERN = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JAVASCRIPT_URL_PATTERN = /(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi;
const UNSAFE_EMBED_PATTERN =
  /<(?:iframe|object|embed)\b[\s\S]*?(?:<\/(?:iframe|object|embed)\s*>|$)/gi;
const GENERIC_STREAMABLE_STRUCTURE_PATTERN =
  /<(?:section|article|main|table|thead|tbody|tr|ul|ol|form|svg|canvas|div)\b/i;

const STREAMABLE_WRAPPER_CLASS_PATTERNS = new Set([
  'product-grid',
  'product-list',
  'products',
  'item-grid',
  'item-list',
  'items',
  'card-grid',
  'card-row',
  'cards',
  'feature-grid',
  'feature-list',
  'stats-grid',
  'metric-grid',
  'dashboard',
  'shop-grid',
  'catalog-grid',
  'artifact-grid',
  'artifact-cards',
  'artifact-list',
  'artifact-flex',
  'artifact-row',
  'comparison',
  'matrix',
  'columns',
  'tab-row',
  'toolbar',
  'button-group',
  'chip-group',
  'team-grid',
  'pricing-grid',
  'pricing-cards',
  'gallery',
  'gallery-grid',
  'menu-grid',
  'menu-items',
]);

type TagEntry = {
  tag: string;
  tagName: string;
  isClosing: boolean;
  isSelfClosing: boolean;
  position: number;
};

type WrapperEntry = {
  openPosition: number;
  contentStart: number;
  tagName: string;
};

function extractTagName(tagContent: string): string {
  const cleaned = tagContent.replace(/^<\//, '<').replace(/\/>$/, '>');
  const match = cleaned.match(/^<\s*([a-zA-Z][a-zA-Z0-9-]*)/);
  return match ? (match[1] ?? '').toLowerCase() : '';
}

function sanitizeStreamingPreviewSource(source: string): string {
  return source
    .replace(COMPLETE_SCRIPT_PATTERN, '')
    .replace(TRAILING_INCOMPLETE_SCRIPT_PATTERN, '')
    .replace(TRAILING_INCOMPLETE_STYLE_PATTERN, '')
    .replace(UNSAFE_EMBED_PATTERN, '')
    .replace(INLINE_EVENT_HANDLER_PATTERN, '')
    .replace(JAVASCRIPT_URL_PATTERN, '$1=$2#$2');
}

function isStreamableWrapperTag(tagContent: string): boolean {
  const classMatch = tagContent.match(/class\s*=\s*["']([^"']*)["']/i);
  if (!classMatch) {
    return false;
  }
  const classes = (classMatch[1] ?? '').split(/\s+/).filter(Boolean);
  return classes.some((className) => STREAMABLE_WRAPPER_CLASS_PATTERNS.has(className));
}

function* scanTags(source: string): Generator<TagEntry> {
  const length = source.length;
  let position = 0;

  while (position < length) {
    if (source.startsWith('<!--', position)) {
      const endIndex = source.indexOf('-->', position + 4);
      if (endIndex === -1) {
        return;
      }
      position = endIndex + 3;
      continue;
    }

    if (source.slice(position).match(/^<!DOCTYPE\s/i)) {
      const endIndex = source.indexOf('>', position);
      if (endIndex === -1) {
        return;
      }
      position = endIndex + 1;
      continue;
    }

    const leftAngleIndex = source.indexOf('<', position);
    if (leftAngleIndex === -1) {
      return;
    }

    const rightAngleIndex = source.indexOf('>', leftAngleIndex + 1);
    if (rightAngleIndex === -1) {
      return;
    }

    const tag = source.slice(leftAngleIndex, rightAngleIndex + 1);
    const tagName = extractTagName(tag);
    position = rightAngleIndex + 1;

    if (!tagName) {
      continue;
    }

    yield {
      tag,
      tagName,
      isClosing: tag.trim().startsWith('</'),
      isSelfClosing: tag.trim().endsWith('/>') || VOID_TAGS.has(tagName),
      position: leftAngleIndex,
    };
  }
}

function findFirstStreamableWrapper(source: string): WrapperEntry | null {
  for (const tag of scanTags(source)) {
    if (tag.isClosing || tag.isSelfClosing) {
      continue;
    }
    if (!isStreamableWrapperTag(tag.tag)) {
      continue;
    }
    return {
      openPosition: tag.position,
      contentStart: tag.position + tag.tag.length,
      tagName: tag.tagName,
    };
  }
  return null;
}

function collectCompletedChildren(
  source: string,
  wrapper: WrapperEntry,
): Array<{ start: number; end: number }> {
  const completedChildren: Array<{ start: number; end: number }> = [];
  let childStartIndex: number | null = null;
  let depth = 1;

  for (const tag of scanTags(source)) {
    if (tag.position < wrapper.contentStart) {
      continue;
    }

    if (tag.isSelfClosing) {
      if (depth === 1) {
        completedChildren.push({
          start: tag.position,
          end: tag.position + tag.tag.length,
        });
      }
      continue;
    }

    if (tag.isClosing) {
      depth -= 1;
      if (depth === 1 && childStartIndex !== null) {
        completedChildren.push({
          start: childStartIndex,
          end: tag.position + tag.tag.length,
        });
        childStartIndex = null;
      }
      if (depth === 0) {
        break;
      }
      continue;
    }

    depth += 1;
    if (depth === 2 && childStartIndex === null) {
      childStartIndex = tag.position;
    }
  }

  return completedChildren;
}

function isWrapperAlreadyClosed(source: string, wrapper: WrapperEntry): boolean {
  let depth = 1;
  for (const tag of scanTags(source)) {
    if (tag.position <= wrapper.openPosition) {
      continue;
    }
    if (tag.isSelfClosing) {
      continue;
    }
    if (tag.isClosing) {
      depth -= 1;
      if (depth === 0) {
        return true;
      }
    } else {
      depth += 1;
    }
  }
  return false;
}

function buildSyntheticClosers(openTagStack: string[]): string {
  return openTagStack
    .slice()
    .reverse()
    .map((tagName) => `</${tagName}>`)
    .join('');
}

function buildPreviewFromSafePrefix(
  source: string,
  safeEndIndex: number,
): StreamablePreviewResult {
  const previewPrefix = source.slice(0, safeEndIndex);
  let openTagStack: string[] = [];

  for (const tag of scanTags(previewPrefix)) {
    if (tag.isSelfClosing) {
      continue;
    }
    if (tag.isClosing) {
      const lastOpenTag = openTagStack[openTagStack.length - 1];
      if (lastOpenTag === tag.tagName) {
        openTagStack = openTagStack.slice(0, -1);
      } else {
        const recoveryIndex = openTagStack.lastIndexOf(tag.tagName);
        if (recoveryIndex !== -1) {
          openTagStack = openTagStack.slice(0, recoveryIndex);
        }
      }
      continue;
    }
    openTagStack.push(tag.tagName);
  }

  const previewSource = `${previewPrefix}${buildSyntheticClosers(openTagStack)}`;
  return {
    canStream: previewSource.trim().length > 0,
    previewSource,
  };
}

export function buildStreamableArtifactPreview(source: string): StreamablePreviewResult {
  if (!source.trim()) {
    return { canStream: false, previewSource: source };
  }

  const sanitizedSource = sanitizeStreamingPreviewSource(source);
  if (!sanitizedSource.trim()) {
    return { canStream: false, previewSource: sanitizedSource };
  }

  const wrapper = findFirstStreamableWrapper(sanitizedSource);
  if (wrapper) {
    if (isWrapperAlreadyClosed(sanitizedSource, wrapper)) {
      // Fully closed wrapper is still safe to show during stream (scripts already stripped).
      return { canStream: true, previewSource: sanitizedSource };
    }
    const completedChildren = collectCompletedChildren(sanitizedSource, wrapper);
    if (completedChildren.length > 0) {
      const lastChild = completedChildren[completedChildren.length - 1];
      if (lastChild) {
        return buildPreviewFromSafePrefix(sanitizedSource, lastChild.end);
      }
    }
    // Open wrapper with no complete children yet — still try generic path below.
  }

  if (!GENERIC_STREAMABLE_STRUCTURE_PATTERN.test(sanitizedSource)) {
    return { canStream: false, previewSource: sanitizedSource };
  }

  let openTagStack: string[] = [];
  let lastSafeEndIndex = -1;

  for (const tag of scanTags(sanitizedSource)) {
    if (tag.isSelfClosing) {
      lastSafeEndIndex = tag.position + tag.tag.length;
      continue;
    }

    if (tag.isClosing) {
      const lastOpenTag = openTagStack[openTagStack.length - 1];
      if (lastOpenTag === tag.tagName) {
        openTagStack = openTagStack.slice(0, -1);
      } else {
        const recoveryIndex = openTagStack.lastIndexOf(tag.tagName);
        if (recoveryIndex !== -1) {
          openTagStack = openTagStack.slice(0, recoveryIndex);
        }
      }
      lastSafeEndIndex = tag.position + tag.tag.length;
      continue;
    }

    openTagStack.push(tag.tagName);
  }

  // Fully balanced sanitized HTML (no open tags) — safe stream preview.
  if (openTagStack.length === 0 && lastSafeEndIndex > 0) {
    return { canStream: true, previewSource: sanitizedSource };
  }

  if (lastSafeEndIndex <= 0) {
    return { canStream: false, previewSource: sanitizedSource };
  }

  const previewResult = buildPreviewFromSafePrefix(sanitizedSource, lastSafeEndIndex);
  if (!previewResult.canStream) {
    return { canStream: false, previewSource: sanitizedSource };
  }

  return previewResult;
}
