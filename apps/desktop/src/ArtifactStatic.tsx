import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  MIN_ARTIFACT_IFRAME_HEIGHT,
  resolveArtifactViewportFrameHeight,
  shouldEnterArtifactInlineOverflow,
  type ArtifactThemeVariables,
} from '@piwin/artifact';
import { artifactOverflowHintCopy } from './artifact-overflow-hint.js';
import { sanitizeStaticArtifactSource } from './artifact-static-sanitizer.js';

export type ArtifactStaticProps = {
  source: string;
  type: 'html' | 'svg';
  theme?: ArtifactThemeVariables;
  locale?: 'zh-CN' | 'en';
};

const ARTIFACT_THEME_VARIABLES = [
  '--piwin-artifact-theme',
  '--piwin-artifact-bg',
  '--piwin-artifact-surface',
  '--piwin-artifact-text',
  '--piwin-artifact-muted',
  '--piwin-artifact-accent',
  '--piwin-artifact-border',
  '--piwin-artifact-radius',
  '--piwin-artifact-font',
] as const satisfies readonly (keyof ArtifactThemeVariables)[];

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
  table-layout: fixed;
}
.piwin-artifact-root th,
.piwin-artifact-root td { overflow-wrap: anywhere; }
`;

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

function buildThemeCss(theme: ArtifactThemeVariables | undefined): string {
  if (!theme) return '';
  return `:host {\n${ARTIFACT_THEME_VARIABLES.map(
    (name) => `  ${name}: ${escapeCssValue(theme[name])};`,
  ).join('\n')}\n}`;
}

/**
 * Render inert Artifact markup in normal transcript flow. Shadow DOM isolates
 * model CSS; DOMPurify is defense-in-depth after the render plan chooses static.
 */
export function ArtifactStatic({
  source,
  type,
  theme,
  locale = 'en',
}: ArtifactStaticProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const [localViewportHeight, setLocalViewportHeight] = useState<number | null>(null);
  const sanitizedSource = useMemo(() => sanitizeStaticArtifactSource(source), [source]);
  const themeCss = useMemo(() => buildThemeCss(theme), [theme]);

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
    baseStyle.textContent = `${themeCss}\n${STATIC_ARTIFACT_BASE_CSS}`;
    const content = document.createElement('div');
    content.className = 'piwin-artifact-root';
    content.innerHTML = sanitizedSource;
    shadowRoot.replaceChildren(baseStyle, content);
    const measure = (): void => {
      setOverflows(shouldEnterArtifactInlineOverflow(content.getBoundingClientRect().height));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [sanitizedSource, themeCss]);

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
      <div
        ref={hostRef}
        className="artifact-static"
        data-testid="artifact-static"
        data-artifact-type={type}
      />
    </div>
  );
}
