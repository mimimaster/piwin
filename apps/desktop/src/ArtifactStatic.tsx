import { useLayoutEffect, useMemo, useRef, type ReactElement } from 'react';
import type { ArtifactPreviewDecision, ArtifactThemeVariables } from '@piwin/artifact';
import { sanitizeStaticArtifactSource } from './artifact-static-sanitizer.js';

type StaticDecision = Extract<ArtifactPreviewDecision, { kind: 'render' }>;

export type ArtifactStaticProps = {
  decision: StaticDecision;
  theme?: ArtifactThemeVariables;
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
  contain: layout paint;
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
  overflow: hidden;
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
 * model CSS; DOMPurify is defense-in-depth after the pure route classifier.
 */
export function ArtifactStatic({ decision, theme }: ArtifactStaticProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sanitizedSource = useMemo(
    () => sanitizeStaticArtifactSource(decision.renderSource),
    [decision.renderSource],
  );
  const themeCss = useMemo(() => buildThemeCss(theme), [theme]);

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
  }, [sanitizedSource, themeCss]);

  return (
    <div
      ref={hostRef}
      className="artifact-static"
      data-testid="artifact-static"
      data-artifact-type={decision.descriptor.type}
    />
  );
}
