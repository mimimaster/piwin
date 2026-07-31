/**
 * Detect open HTML artifact fences while assistant text is still streaming.
 * Ported/simplified from openwebui_m artifactStreaming.
 */
import {
  AMBIGUOUS_ARTIFACT_LANGUAGE_ALIASES,
  ARTIFACT_LANGUAGE_ALIASES,
  NATIVE_HTML_ARTIFACT_LANGUAGES,
  NATIVE_SVG_ARTIFACT_LANGUAGES,
} from './constants.js';
import type { OpenArtifactFence } from './types.js';

const ARTIFACT_ALIAS_SET = new Set<string>(ARTIFACT_LANGUAGE_ALIASES);
const AMBIGUOUS_ALIAS_SET = new Set<string>(AMBIGUOUS_ARTIFACT_LANGUAGE_ALIASES);
const NATIVE_HTML_SET = new Set<string>(NATIVE_HTML_ARTIFACT_LANGUAGES);
const NATIVE_SVG_SET = new Set<string>(NATIVE_SVG_ARTIFACT_LANGUAGES);

const FENCE_LINE_PATTERN = /^```([^\n`]*)$/gm;
const COMPLETE_FENCE_BLOCK_PATTERN = /^```([^\n`]*)\n([\s\S]*?)\n?```/gm;

const ARTIFACT_TAG_OPEN_PATTERN = /<artifact-html(\s[^>]*)?>/gi;
const ARTIFACT_TAG_CLOSE_PATTERN = /<\/artifact-html\s*>/gi;
const ARTIFACT_TAG_TITLE_PATTERN = /title\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

const HTML_LIKE_SOURCE_PATTERN =
  /<\s*(?:style|script|div|section|article|main|aside|header|footer|button|input|select|textarea|form|table|ul|ol|li|details|summary|dialog|canvas|svg)\b|--piwin-artifact-/i;
const NATIVE_HTML_UI_SOURCE_PATTERN =
  /(?:<!doctype\s+html\b|<\s*html\b|<\s*body\b|<\s*style\b|<\s*iframe\b|<\s*(?:section|main|article|details|summary|form|button|table)\b|<\s*div\b[^>]*(?:class|id)\s*=)/i;
const SVG_LIKE_SOURCE_PATTERN = /<\s*svg\b/i;
const PLACEHOLDER_SOURCE_PATTERN =
  /^(?:enter your code here\.{0,3}|todo|tbd|placeholder|\/\/\s*todo|<!--\s*(?:todo|placeholder|visible content here)\s*-->)$/i;

function getAlias(info: string): string {
  return info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

function isArtifactLanguageAlias(info: string): boolean {
  return ARTIFACT_ALIAS_SET.has(getAlias(info));
}

function isAmbiguousArtifactLanguageAlias(info: string): boolean {
  const alias = getAlias(info);
  return AMBIGUOUS_ALIAS_SET.has(alias) || alias === 'artifact' || alias.startsWith('artifact-');
}

function isNativeHtmlLanguage(info: string): boolean {
  return NATIVE_HTML_SET.has(getAlias(info));
}

function isNativeSvgLanguage(info: string): boolean {
  return NATIVE_SVG_SET.has(getAlias(info));
}

function isHtmlLikeArtifactSource(source: string): boolean {
  return HTML_LIKE_SOURCE_PATTERN.test(source);
}

function isUiLikeHtmlArtifactSource(source: string): boolean {
  return NATIVE_HTML_UI_SOURCE_PATTERN.test(source);
}

function isPlaceholderArtifactSource(source: string): boolean {
  const trimmed = source.trim();
  return !trimmed || PLACEHOLDER_SOURCE_PATTERN.test(trimmed);
}

function toArtifactHtmlInfo(info: string): string {
  const trimmedInfo = info.trim();
  const firstWhitespaceIndex = trimmedInfo.search(/\s/);
  const withoutAlias =
    firstWhitespaceIndex === -1 ? '' : trimmedInfo.slice(firstWhitespaceIndex).trim();
  return withoutAlias ? `artifact-html ${withoutAlias}` : 'artifact-html';
}

/**
 * Find the last open (unclosed) artifact fence in streaming markdown.
 */
export function findOpenArtifactFence(
  content: string,
  htmlUiModeEnabled: boolean,
): OpenArtifactFence | null {
  if (!htmlUiModeEnabled) {
    return null;
  }

  let activeFence: OpenArtifactFence | null = null;
  FENCE_LINE_PATTERN.lastIndex = 0;

  for (const match of content.matchAll(FENCE_LINE_PATTERN)) {
    const info = (match[1] ?? '').trim();
    const startIndex = match.index ?? 0;
    const lineBreakIndex = content.indexOf('\n', startIndex);
    const contentStartIndex = lineBreakIndex === -1 ? content.length : lineBreakIndex + 1;

    if (activeFence) {
      activeFence = null;
      continue;
    }

    const source = content.slice(contentStartIndex);
    if (
      isArtifactLanguageAlias(info) ||
      (isAmbiguousArtifactLanguageAlias(info) && isHtmlLikeArtifactSource(source)) ||
      (isNativeHtmlLanguage(info) && isUiLikeHtmlArtifactSource(source)) ||
      (isNativeSvgLanguage(info) && SVG_LIKE_SOURCE_PATTERN.test(source))
    ) {
      activeFence = { startIndex, info, contentStartIndex };
    }
  }

  return activeFence;
}

export function findOpenAmbiguousArtifactFence(
  content: string,
  htmlUiModeEnabled: boolean,
): OpenArtifactFence | null {
  if (!htmlUiModeEnabled) {
    return null;
  }

  let activeFence: OpenArtifactFence | null = null;
  FENCE_LINE_PATTERN.lastIndex = 0;

  for (const match of content.matchAll(FENCE_LINE_PATTERN)) {
    const info = (match[1] ?? '').trim();
    const startIndex = match.index ?? 0;
    const lineBreakIndex = content.indexOf('\n', startIndex);
    const contentStartIndex = lineBreakIndex === -1 ? content.length : lineBreakIndex + 1;

    if (activeFence) {
      activeFence = null;
      continue;
    }

    if (isAmbiguousArtifactLanguageAlias(info)) {
      activeFence = { startIndex, info, contentStartIndex };
    }
  }

  return activeFence;
}

export function normalizeAmbiguousArtifactFences(
  content: string,
  htmlUiModeEnabled: boolean,
  done: boolean,
): string {
  if (!htmlUiModeEnabled) {
    return content;
  }

  let normalized = content.replace(
    COMPLETE_FENCE_BLOCK_PATTERN,
    (raw, info: string, source: string) => {
      if (!isAmbiguousArtifactLanguageAlias(info)) {
        return raw;
      }
      if (!isPlaceholderArtifactSource(source) && !isHtmlLikeArtifactSource(source)) {
        return raw;
      }
      return `\`\`\`${toArtifactHtmlInfo(info)}\n${source}\n\`\`\``;
    },
  );

  if (!done) {
    const openFence = findOpenAmbiguousArtifactFence(normalized, htmlUiModeEnabled);
    if (openFence) {
      const source = normalized.slice(openFence.contentStartIndex);
      if (isHtmlLikeArtifactSource(source)) {
        normalized =
          normalized.slice(0, openFence.startIndex) +
          `\`\`\`${toArtifactHtmlInfo(openFence.info)}\n` +
          source;
      }
    }
  }

  return normalized;
}

export function normalizeArtifactTagBlocks(
  content: string,
  htmlUiModeEnabled: boolean,
  done: boolean,
): string {
  if (!htmlUiModeEnabled) {
    return content;
  }

  let result = content;
  let changed = true;

  while (changed) {
    changed = false;
    ARTIFACT_TAG_OPEN_PATTERN.lastIndex = 0;
    const openMatch = ARTIFACT_TAG_OPEN_PATTERN.exec(result);
    if (!openMatch) {
      break;
    }

    const openTagStart = openMatch.index;
    const openTagEnd = openTagStart + openMatch[0].length;
    const attributes = openMatch[1] ?? '';
    const titleMatch = ARTIFACT_TAG_TITLE_PATTERN.exec(attributes);
    const title = titleMatch?.[1] ?? titleMatch?.[2] ?? '';
    const fenceInfo = title ? `artifact-html title="${title}"` : 'artifact-html';

    ARTIFACT_TAG_CLOSE_PATTERN.lastIndex = openTagEnd;
    const closeMatch = ARTIFACT_TAG_CLOSE_PATTERN.exec(result);

    if (closeMatch) {
      const innerContent = result.slice(openTagEnd, closeMatch.index);
      const replacement = `\`\`\`${fenceInfo}\n${innerContent}\n\`\`\``;
      result =
        result.slice(0, openTagStart) +
        replacement +
        result.slice(closeMatch.index + closeMatch[0].length);
      changed = true;
    } else if (!done) {
      const innerContent = result.slice(openTagEnd);
      const replacement = `\`\`\`${fenceInfo}\n${innerContent}`;
      result = result.slice(0, openTagStart) + replacement;
      changed = true;
    }
  }

  return result;
}

/**
 * Normalize streaming markdown so incomplete artifact fences can be split/parsed.
 * When not done, closes an open artifact fence with a synthetic trailing fence.
 */
export function normalizeStreamingArtifactFences(
  content: string,
  htmlUiModeEnabled: boolean,
  done: boolean,
): string {
  if (!htmlUiModeEnabled) {
    return content;
  }

  const tagNormalized = normalizeArtifactTagBlocks(content, htmlUiModeEnabled, done);
  const ambiguousNormalized = normalizeAmbiguousArtifactFences(
    tagNormalized,
    htmlUiModeEnabled,
    done,
  );

  if (done) {
    return ambiguousNormalized;
  }
  if (!findOpenArtifactFence(ambiguousNormalized, htmlUiModeEnabled)) {
    return ambiguousNormalized;
  }

  return ambiguousNormalized.endsWith('\n')
    ? `${ambiguousNormalized}\`\`\``
    : `${ambiguousNormalized}\n\`\`\``;
}
