import type { ArtifactFixtureId } from './types.js';

export function artifactEndMarker(id: ArtifactFixtureId | 'streaming-script'): string {
  return `<div data-artifact-end="${id}">END:${id}</div>`;
}

function tallColumn(id: ArtifactFixtureId, heightPx: number): string {
  return [
    `<script>window.__piwinFixture=${JSON.stringify(id)}</script>`,
    `<div data-fixture="${id}" style="height:${String(heightPx)}px;box-sizing:border-box;padding:16px;background:#1b1f24;color:#eee">`,
    `<p>START:${id}</p>`,
    '</div>',
    artifactEndMarker(id),
  ].join('');
}

export const INERT_FRAGMENT_HTML = [
  '<section class="card"><h1>Inert fragment</h1><p>No script, no viewport coupling.</p></section>',
  artifactEndMarker('inert-fragment'),
].join('');

export const SCRIPT_FRAGMENT_HTML = [
  '<button type="button" id="count">0</button>',
  '<script>count.onclick=function(){count.textContent=String(Number(count.textContent)+1)}</script>',
  artifactEndMarker('script-fragment'),
].join('');

/**
 * Vault image id is a placeholder; the host binds it at materialize time.
 * The script keeps this fixture on the sandbox path, where a `blob:` src
 * would be unreadable and only an inlined `data:` image can paint.
 */
export const SESSION_MEDIA_MEDIA_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

export const SESSION_MEDIA_HTML = [
  '<figure style="margin:0"><img data-piwin-media="' +
    SESSION_MEDIA_MEDIA_ID +
    '" alt="Vault asset" data-testid="session-media-img" style="width:64px;height:64px">',
  '<figcaption>Session vault image</figcaption></figure>',
  '<script>window.__piwinFixture="session-media"</script>',
  artifactEndMarker('session-media'),
].join('');

export const NATIVE_SVG_SOURCE =
  '<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="40" r="24" fill="teal" /></svg>';

export const FULL_HTML_DOCUMENT_SOURCE = [
  '<!DOCTYPE html>',
  '<html><head><title>Full document</title></head>',
  '<body>',
  '<main style="min-height:1200px"><h1>Full HTML document</h1></main>',
  artifactEndMarker('full-html-document'),
  '</body></html>',
].join('');

export const VIEWPORT_100VH_HTML = [
  '<style>.stage{height:100vh;background:#222;color:#eee;padding:16px}</style>',
  '<div class="stage" id="stage"><p>100vh / innerHeight</p></div>',
  '<script>stage.style.minHeight=String(window.innerHeight)+"px"</script>',
  artifactEndMarker('viewport-100vh'),
].join('');

export const LOCAL_FIXED_TOAST_HTML = [
  '<section class="card"><p>Page content under a local toast.</p></section>',
  '<div style="position:fixed;right:16px;bottom:16px;padding:8px 12px;background:#111;color:#fff">Saved</div>',
].join('');

export const FOUR_EDGE_FIXED_SHELL_HTML = [
  '<style>',
  'html,body{margin:0;height:100%}',
  '.shell{position:fixed;inset:0;display:flex;flex-direction:column;background:#111;color:#eee}',
  'header,footer{height:48px}',
  'main{flex:1;overflow:auto;padding:16px}',
  '</style>',
  '<div class="shell">',
  '<header>Four-edge fixed shell</header>',
  '<main><p>Inner page</p></main>',
  '<footer>Footer</footer>',
  artifactEndMarker('four-edge-fixed-shell'),
  '</div>',
].join('');

export const FLOW_6000_HTML = tallColumn('flow-6000', 6_000);

export const OVERFLOW_20000_HTML = tallColumn('overflow-20000', 20_000);

export const EXPLICIT_CANVAS_HTML = [
  '<script>window.__piwinFixture="explicit-canvas"</script>',
  '<div style="width:1200px;height:800px;padding:16px;background:#102a43;color:#f0f4f8">Wide canvas workspace</div>',
  artifactEndMarker('explicit-canvas'),
].join('');

export const BLOCKED_EXTERNAL_HTML =
  '<img src="https://example.com/pixel.png" alt="blocked external resource" />';
