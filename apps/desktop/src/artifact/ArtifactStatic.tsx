import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactElement,
} from 'react';
import {
  EMOJI_ICON_CSS,
  MIN_ARTIFACT_IFRAME_HEIGHT,
  buildArtifactComponentKitCss,
  buildArtifactDiagramKitCss,
  buildArtifactReportKitCss,
  countShatteredText,
  replaceEmojiIconsInTree,
  resolveArtifactThemeCssVariables,
  resolveArtifactViewportFrameHeight,
  shouldEnterArtifactInlineOverflow,
  straightenLeftAccents,
  type ArtifactRules,
  type ArtifactThemeVariables,
} from '@piwin/artifact';
import { ArtifactLayoutBadge } from './artifact-layout-badge.js';
import { artifactOverflowHintCopy } from './artifact-overflow-hint.js';
import { copyArtifactSelectionText } from './artifact-selection-copy.js';
import { authorizeStaticArtifactStyles } from './artifact-static-styles.js';
import {
  sanitizeStaticArtifactSource,
  sanitizeStaticArtifactSourceNow,
} from './artifact-static-sanitizer.js';

export type ArtifactStaticProps = {
  source: string;
  type: 'html' | 'svg';
  theme?: ArtifactThemeVariables;
  /** Rules the source was written under; selects the `on-accent` ink. */
  rules?: ArtifactRules;
  locale?: 'zh-CN' | 'en';
  /** Lets the layout badge draft a fix request; absent means label only. */
  onComposerProposal?: (payload: { text: string; label?: string }) => void;
};

/**
 * Typography the shadow tree inherits from the transcript instead (see the
 * `ArtifactThemeVariables` notes); only the sandbox needs them passed in.
 */
const INHERITED_TYPOGRAPHY_VARIABLES = new Set([
  '--piwin-artifact-font-size',
  '--piwin-artifact-line-height',
  '--piwin-artifact-letter-spacing',
  '--piwin-artifact-font-smoothing',
]);

const STATIC_ARTIFACT_BASE_CSS = `
:host {
  display: block;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  contain: layout;
  color: var(--piwin-artifact-text, inherit);
  font-family: var(--piwin-artifact-font, inherit);
}
*, *::before, *::after { box-sizing: border-box; }
.piwin-artifact-root {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding: 4px 0;
  overflow-x: hidden;
  overflow-y: visible;
  overflow-wrap: break-word;
  background: transparent;
  color: var(--piwin-artifact-text, inherit);
}
.piwin-artifact-root > *,
.piwin-artifact-root img,
.piwin-artifact-root svg,
.piwin-artifact-root canvas,
.piwin-artifact-root video,
.piwin-artifact-root table,
.piwin-artifact-root pre {
  min-width: 0;
  max-width: 100%;
}
.piwin-artifact-root > svg {
  display: block;
  width: auto;
  height: auto;
  margin-inline: auto;
  overflow: visible;
}
.piwin-artifact-root img,
.piwin-artifact-root canvas,
.piwin-artifact-root video { height: auto; }
.piwin-artifact-root pre,
.piwin-artifact-root code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.piwin-artifact-root table {
  width: 100%;
  table-layout: auto;
}
.piwin-artifact-root th,
.piwin-artifact-root td { overflow-wrap: break-word; }
`;

/**
 * The Report Kit and Diagram Kit, as the sandbox ships them, plus the Inline measure: the chat
 * column already supplies the gutter. The kit's own Inline rule keys off the
 * sandbox document's `<html data-frame-mode>`, which a shadow tree has not.
 * Without this a kit report loses all styling the moment its stream finishes
 * and the static renderer takes over.
 */
function buildStaticReportKitCss(rules: ArtifactRules): string {
  return `${buildArtifactReportKitCss({ rules })}${buildArtifactDiagramKitCss()}${buildArtifactComponentKitCss()}
.piwin-artifact-root > .piwin-report {
  max-width: 100%;
  margin: 0;
  padding: 2px 0 6px;
}
.piwin-artifact-root .piwin-lanes td {
  min-width: 4.5em;
}
`;
}

function resolveLocalArtifactViewportHeight(element: HTMLElement | null): number {
  const windowHeight = typeof window === 'undefined' ? 640 : window.innerHeight;
  const preferredHeight = resolveArtifactViewportFrameHeight(windowHeight);
  if (element === null) return preferredHeight;
  const paneHeight = element.closest<HTMLElement>('.conversation-pane-session')?.clientHeight;
  return paneHeight !== undefined && paneHeight > 0
    ? Math.min(preferredHeight, Math.max(MIN_ARTIFACT_IFRAME_HEIGHT, paneHeight))
    : preferredHeight;
}

function escapeCssValue(value: string): string {
  return value.replace(/[;{}]/g, '').trim();
}

function buildThemeCss(theme: ArtifactThemeVariables | undefined, rules: ArtifactRules): string {
  if (!theme) return '';
  const variables = resolveArtifactThemeCssVariables(theme, rules).filter(
    ([name]) => !INHERITED_TYPOGRAPHY_VARIABLES.has(name),
  );
  // `color-scheme` keeps system colors (the contract's `Canvas` ink) on the
  // artifact theme rather than whatever the surrounding app resolves to.
  return `:host {\n${variables
    .map(([name, value]) => `  ${name}: ${escapeCssValue(value)};`)
    .join('\n')}\n  color-scheme: ${theme['--piwin-artifact-theme']};\n}`;
}

/**
 * Render inert Artifact markup in normal transcript flow. Shadow DOM isolates
 * model CSS; DOMPurify is defense-in-depth after the render plan chooses static.
 */
export function ArtifactStatic({
  source,
  type,
  theme,
  rules = 'legacy',
  locale = 'en',
  onComposerProposal,
}: ArtifactStaticProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const [shatteredText, setShatteredText] = useState(0);
  const [localViewportHeight, setLocalViewportHeight] = useState<number | null>(null);
  // Sanitized in render once the sanitizer is loaded, so the first commit
  // already carries the content and the Artifact never paints empty.
  const sanitizedNow = useMemo(() => sanitizeStaticArtifactSourceNow(source), [source]);
  const [sanitizedLater, setSanitizedLater] = useState<{ source: string; value: string } | null>(
    null,
  );
  const sanitizedSource =
    sanitizedNow ?? (sanitizedLater?.source === source ? sanitizedLater.value : '');
  const themeCss = useMemo(() => buildThemeCss(theme, rules), [theme, rules]);
  const reportKitCss = useMemo(() => buildStaticReportKitCss(rules), [rules]);

  useEffect(() => {
    if (sanitizedNow !== null) return;
    let cancelled = false;
    void sanitizeStaticArtifactSource(source).then((value) => {
      if (!cancelled) setSanitizedLater({ source, value });
    });
    return () => {
      cancelled = true;
    };
  }, [sanitizedNow, source]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = (): void => {
      const nextHeight = resolveLocalArtifactViewportHeight(host);
      setLocalViewportHeight((current) => (current === nextHeight ? current : nextHeight));
    };
    update();
    const pane = host.closest<HTMLElement>('.conversation-pane-session');
    if (typeof ResizeObserver !== 'undefined' && pane) {
      const observer = new ResizeObserver(update);
      observer.observe(pane);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const baseStyle = document.createElement('style');
    baseStyle.dataset['piwinArtifactStaticBase'] = '';
    baseStyle.textContent = `${themeCss}\n${STATIC_ARTIFACT_BASE_CSS}\n${reportKitCss}\n${EMOJI_ICON_CSS}`;
    const content = document.createElement('div');
    content.className = 'piwin-artifact-root';
    content.innerHTML = sanitizedSource;
    authorizeStaticArtifactStyles(baseStyle, content);
    // ADR 0090: mapped emoji → Tabler icons, once per sanitized tree.
    replaceEmojiIconsInTree(content);
    shadowRoot.replaceChildren(baseStyle, content);
    straightenLeftAccents(shadowRoot, window);
    const measure = (): void => {
      setOverflows(shouldEnterArtifactInlineOverflow(content.getBoundingClientRect().height));
      // Same probe the sandbox runs in its frame; here the host owns the tree.
      setShatteredText(countShatteredText(shadowRoot, window));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [sanitizedSource, themeCss, reportKitCss]);

  const copySelectionAsText = (event: ClipboardEvent<HTMLDivElement>): void => {
    const shadowRoot = hostRef.current?.shadowRoot;
    if (shadowRoot) {
      copyArtifactSelectionText(event, shadowRoot);
    }
  };

  const chrome = localViewportHeight ?? resolveLocalArtifactViewportHeight(hostRef.current);
  const hint = artifactOverflowHintCopy(locale);

  return (
    <div
      className={overflows ? 'artifact-static-overflow-shell' : undefined}
      {...(overflows
        ? {
            'data-testid': 'artifact-static-overflow-shell',
            tabIndex: 0,
            role: 'region',
            'aria-label': hint,
            style: {
              height: chrome,
              maxHeight: chrome,
              overflowY: 'auto',
              overflowX: 'hidden',
              overscrollBehavior: 'contain',
            },
          }
        : {})}
    >
      {overflows ? (
        <p
          className="artifact-overflow-hint"
          data-testid="artifact-overflow-hint"
          role="status"
          aria-live="polite"
        >
          {hint}
        </p>
      ) : null}
      <ArtifactLayoutBadge
        shatteredText={shatteredText}
        locale={locale}
        onComposerProposal={onComposerProposal}
      />
      <div
        ref={hostRef}
        onCopy={copySelectionAsText}
        className="artifact-static"
        data-testid="artifact-static"
        data-artifact-type={type}
      />
    </div>
  );
}
