import { FLASHCARD_TOOL_RESULT } from './flashcard.js';
import {
  BLOCKED_EXTERNAL_HTML,
  EXPLICIT_CANVAS_HTML,
  FLOW_6000_HTML,
  FOUR_EDGE_FIXED_SHELL_HTML,
  FULL_HTML_DOCUMENT_SOURCE,
  INERT_FRAGMENT_HTML,
  LOCAL_FIXED_TOAST_HTML,
  NATIVE_SVG_SOURCE,
  OVERFLOW_20000_HTML,
  SCRIPT_FRAGMENT_HTML,
  VIEWPORT_100VH_HTML,
} from './html.js';
import { wrapArtifactMarkdown } from './markdown.js';
import {
  ARTIFACT_FIXTURE_IDS,
  type ArtifactFixture,
  type ArtifactFixtureId,
} from './types.js';

function fixture(
  id: ArtifactFixtureId,
  title: string,
  kind: ArtifactFixture['kind'],
  language: string,
  source: string,
  scrollable: boolean,
): ArtifactFixture {
  return {
    id,
    title,
    kind,
    language,
    source,
    scrollable,
    markdown: wrapArtifactMarkdown(language, source),
  };
}

const FIXTURES: Record<ArtifactFixtureId, ArtifactFixture> = {
  'inert-fragment': fixture(
    'inert-fragment',
    'Inert fragment',
    'html',
    'artifact-html',
    INERT_FRAGMENT_HTML,
    true,
  ),
  'script-fragment': fixture(
    'script-fragment',
    'Script fragment',
    'html',
    'artifact-html',
    SCRIPT_FRAGMENT_HTML,
    true,
  ),
  'native-svg': fixture('native-svg', 'Native SVG', 'svg', 'svg', NATIVE_SVG_SOURCE, false),
  'full-html-document': fixture(
    'full-html-document',
    'Full HTML document',
    'html',
    'html',
    FULL_HTML_DOCUMENT_SOURCE,
    true,
  ),
  'viewport-100vh': fixture(
    'viewport-100vh',
    '100vh / innerHeight',
    'html',
    'artifact-html',
    VIEWPORT_100VH_HTML,
    true,
  ),
  'local-fixed-toast': fixture(
    'local-fixed-toast',
    'Local fixed toast',
    'html',
    'artifact-html',
    LOCAL_FIXED_TOAST_HTML,
    false,
  ),
  'four-edge-fixed-shell': fixture(
    'four-edge-fixed-shell',
    'Four-edge fixed page shell',
    'html',
    'artifact-html',
    FOUR_EDGE_FIXED_SHELL_HTML,
    true,
  ),
  'flow-6000': fixture('flow-6000', '6,000px flow', 'html', 'artifact-html', FLOW_6000_HTML, true),
  'overflow-20000': fixture(
    'overflow-20000',
    '20,000px overflow',
    'html',
    'artifact-html',
    OVERFLOW_20000_HTML,
    true,
  ),
  'explicit-canvas': fixture(
    'explicit-canvas',
    'Explicit Canvas',
    'html',
    'artifact-html title="Wide workspace" surface="canvas"',
    EXPLICIT_CANVAS_HTML,
    true,
  ),
  'blocked-external': fixture(
    'blocked-external',
    'Blocked external resource',
    'html',
    'artifact-html',
    BLOCKED_EXTERNAL_HTML,
    false,
  ),
  'flashcard-tool-result': fixture(
    'flashcard-tool-result',
    'Flashcard tool result',
    'tool-result',
    'html',
    FLASHCARD_TOOL_RESULT.parsed.artifactHtml,
    false,
  ),
};

export const ARTIFACT_FIXTURES: readonly ArtifactFixture[] = ARTIFACT_FIXTURE_IDS.map(
  (id) => FIXTURES[id],
);

export function getArtifactFixture(id: ArtifactFixtureId): ArtifactFixture {
  return FIXTURES[id];
}
