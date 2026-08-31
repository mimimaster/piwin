/**
 * Local-file markdown links vs Streamdown/rehype-harden.
 *
 * Harden always blocks `file:` and also blocks bare relative hrefs like
 * `cropped-portraits-16.zip` (they do not parse as URLs). The product wants
 * those to open as PathChips, not render as `name [blocked]`.
 *
 * Rewrite local-file markdown links before Streamdown so harden never sees a
 * dead hyperlink; absolute filesystem paths stay as links for the `a` renderer.
 */

const WEB_OR_SPECIAL_SCHEME =
  /^(https?:|mailto:|javascript:|data:|blob:|tel:|#)/i;

/** Extensions agents commonly offer as downloadable / openable deliverables. */
const LOCAL_FILE_EXTENSION_PATTERN =
  /\.(zip|tar|tgz|gz|7z|rar|png|jpe?g|gif|webp|svg|bmp|ico|avif|pdf|html?|md|txt|csv|tsv|json|mp4|webm|mov|m4v|wasm|dmg|pkg|docx?|xlsx?|pptx?|xml|ya?ml|toml|rs|ts|tsx|js|jsx|py|go|java|kt|swift|c|cpp|h|hpp|css|scss|sh|zsh|bash|sql|sqlite|db|bin|exe|app|ipa|apk)(?:$|[?#])/i;

const ABSOLUTE_UNIX_PREFIX = /^\/(Users|home|private|tmp|var|Volumes|opt|mnt)\//i;

function stripAngleBrackets(href: string): string {
  const trimmed = href.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Strip `file:` and decode percent-encoding. Does not resolve `~`.
 */
export function normalizeLocalFileHref(href: string): string {
  let path = stripAngleBrackets(href);
  if (/^file:/i.test(path)) {
    // file:///Users/x → /Users/x ; file://localhost/Users/x → /Users/x
    path = path.replace(/^file:\/\/localhost/i, '');
    path = path.replace(/^file:\/\//i, '');
    // Windows file:///C:/x → /C:/x then normalize; keep leading slash for unix.
    if (/^\/[A-Za-z]:[\\/]/.test(path)) {
      path = path.slice(1);
    } else if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) {
      path = `/${path}`;
    }
  }
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * True when a markdown link href should be treated as a local filesystem path
 * (workspace-relative deliverable, absolute host path, or file: URL) rather
 * than a web navigation target.
 */
export function isLocalFileMarkdownHref(href: string): boolean {
  const raw = stripAngleBrackets(href);
  if (!raw || WEB_OR_SPECIAL_SCHEME.test(raw)) {
    return false;
  }
  if (/^file:/i.test(raw)) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(raw)) {
    return true;
  }
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return true;
  }
  if (raw.startsWith('./') || raw.startsWith('../')) {
    return true;
  }
  if (raw.startsWith('/')) {
    if (ABSOLUTE_UNIX_PREFIX.test(raw) || raw.includes('/.piwin/')) {
      return true;
    }
    // Absolute path with a deliverable extension (agent paste of /tmp/out.zip).
    return LOCAL_FILE_EXTENSION_PATTERN.test(raw);
  }
  // Bare relative: foo.zip, cropped-portraits/, dir/file.png
  if (raw.includes('://')) {
    return false;
  }
  if (raw.endsWith('/')) {
    return /^[\w.\u4e00-\u9fa5_-]+(?:\/[\w.\u4e00-\u9fa5_-]+)*\/$/.test(raw);
  }
  if (LOCAL_FILE_EXTENSION_PATTERN.test(raw)) {
    return true;
  }
  return raw.includes('/') && !raw.startsWith('/') && LOCAL_FILE_EXTENSION_PATTERN.test(raw);
}

/**
 * Archives / media / markup agents offer as clickable deliverables.
 * Source and config extensions (`ts`, `md`, `json`, …) are not chips unless
 * the mention is an actual path (`src/app.ts`, `/Users/…/README.md`).
 */
const BARE_DELIVERABLE_EXTENSION_PATTERN =
  /\.(zip|tar|tgz|gz|7z|rar|png|jpe?g|gif|webp|svg|bmp|ico|avif|pdf|html?|mp4|webm|mov|m4v|wasm|dmg|pkg|docx?|xlsx?|pptx?|exe|app|ipa|apk)(?:$|[?#])/i;

function isBareFilename(value: string): boolean {
  return (
    !value.includes('/') &&
    !value.includes('\\') &&
    !/^file:/i.test(value) &&
    !value.startsWith('~')
  );
}

/**
 * True when an inline-code / bare-text string should render as a PathChip.
 * Paths (separators, `file:`, `~`) stay clickable. Bare names only chip when
 * they look like a downloadable artifact (`.zip`, `.svg`, `.html`, …), not a
 * source-file mention such as `main.ts` or `.md`.
 */
export function isLocalPathChipCandidate(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.length > 512) {
    return false;
  }
  if (WEB_OR_SPECIAL_SCHEME.test(trimmed) && !/^file:/i.test(trimmed)) {
    return false;
  }
  if (isLocalFileMarkdownHref(trimmed)) {
    if (isBareFilename(trimmed)) {
      return BARE_DELIVERABLE_EXTENSION_PATTERN.test(trimmed);
    }
    return true;
  }
  return (
    !trimmed.includes('://') &&
    !trimmed.includes(' ') &&
    BARE_DELIVERABLE_EXTENSION_PATTERN.test(trimmed)
  );
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/[[\]]/g, '');
}

/**
 * Rewrite local-file markdown links so rehype-harden cannot emit `[blocked]`.
 *
 * - Absolute / home / file: paths → keep as `[label](normalizedPath)` (harden
 *   allows `/…` hrefs; the `a` renderer turns them into PathChips).
 * - Relative / bare deliverable paths → inline `` `path` `` (code renderer
 *   PathChip). Harden never sees a relative href that fails URL parsing.
 */
export function rewriteLocalFileMarkdownLinks(markdown: string): string {
  // Match [label](href) and optional angle-bracket hrefs. Skip images (![).
  return markdown.replace(
    /(^|[^!])\[([^\]]*)\]\((<?)([^)\s>]+)(>?)\)/g,
    (full, prefix: string, label: string, _open: string, href: string) => {
      if (!isLocalFileMarkdownHref(href)) {
        return full;
      }
      const path = normalizeLocalFileHref(href);
      const isAbsolute =
        path.startsWith('/') ||
        /^[A-Za-z]:[\\/]/.test(path) ||
        path.startsWith('~/') ||
        path.startsWith('~\\');
      if (isAbsolute) {
        const safeLabel = escapeMarkdownLinkLabel(label.trim() || path.split(/[\\/]/).pop() || path);
        return `${prefix}[${safeLabel}](${path})`;
      }
      // Relative: backticks. Escape any backticks inside the path.
      const safePath = path.replace(/`/g, "'");
      return `${prefix}\`${safePath}\``;
    },
  );
}

/**
 * Regex for scanning plain text for absolute (or file:/~) paths to chip.
 * Relative bare names are handled via the inline-code rewrite path instead.
 */
export const MARKDOWN_LOCAL_PATH_TEXT_PATTERN =
  /(?:file:\/\/[^\s]+|~\/[\w\u4e00-\u9fa5_.\/-]+|\/(?:Users|home|private|tmp|var|Volumes|opt|mnt|\.piwin)\/[\w\u4e00-\u9fa5_.\/-]+|[A-Za-z]:[\\/][\w\u4e00-\u9fa5_.\\\/-]+)/g;
