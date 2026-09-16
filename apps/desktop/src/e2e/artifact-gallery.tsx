/**
 * E2E-only Artifact gallery. Reached only through the build-time gated
 * fixture route in DesktopThemeRoot (`VITE_PIWIN_E2E_FIXTURES` + `#/e2e/artifacts`).
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { analyzeArtifactFence, createArtifactFenceRecord, createDefaultArtifactTheme } from '@piwin/artifact';
import {
  ARTIFACT_FIXTURES,
  STREAMING_DELTA_STEPS,
  getArtifactFixture,
  type ArtifactFixture,
  type ArtifactFixtureId,
} from '@piwin/artifact/fixtures';
import { ArtifactCanvasPanel } from '../artifact-canvas-panel';
import { MediaPreviewReadProvider } from '../media-preview-read-context';
import { createArtifactCanvasTarget, type ArtifactCanvasTarget } from '../artifact-canvas-model';
import { MarkdownView } from '../MarkdownView';
import { CodePreviewGallery } from './code-preview-gallery.js';

const GALLERY_ROOT_STYLE: CSSProperties = {
  minHeight: '100vh',
  padding: '24px',
  background: 'var(--canvas)',
  color: 'var(--text)',
  fontFamily: 'var(--font)',
};

const CASE_STYLE: CSSProperties = {
  marginBottom: '32px',
  maxWidth: '720px',
};

const CANVAS_STAGE_STYLE: CSSProperties = {
  height: '70vh',
  minHeight: 480,
  display: 'flex',
  flexDirection: 'column',
  marginTop: '16px',
  background: 'var(--void)',
};

const ARTIFACT_GALLERY_SESSION = 'e2e-artifacts';

function readGallerySelection(): string | null {
  const hash = window.location.hash;
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) return null;
  return new URLSearchParams(hash.slice(queryIndex + 1)).get('id');
}

function canvasTargetFor(fixture: ArtifactFixture): ArtifactCanvasTarget | null {
  const analysis = analyzeArtifactFence(
    createArtifactFenceRecord({ info: fixture.language, source: fixture.source }),
    { id: `${ARTIFACT_GALLERY_SESSION}-${fixture.id}` },
  );
  if (analysis.kind !== 'intent' || analysis.intent.layout !== 'canvas') return null;
  return createArtifactCanvasTarget({
    sessionId: ARTIFACT_GALLERY_SESSION,
    messageId: fixture.id,
    fenceIndex: 0,
    intent: analysis.intent,
  });
}

/** 8x8 opaque PNG, stands in for a session-vault asset. */
const GALLERY_MEDIA_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mOwbvqGFTEMLQkAT35swbMuMlMAAAAASUVORK5CYII=';

/**
 * Stand-in for the Host `media/read` vault reader: it hands back a blob object
 * URL exactly as the real one does, so the gallery exercises the whole
 * blob → size-capped `data:` conversion the sandbox depends on.
 */
async function readGalleryMedia(): Promise<string | null> {
  const blob = await (await fetch(GALLERY_MEDIA_PNG)).blob();
  return URL.createObjectURL(blob);
}

function ArtifactGalleryCase(props: { fixture: ArtifactFixture }): ReactElement {
  const autoCanvas = props.fixture.id === 'explicit-canvas';
  const [canvasTarget, setCanvasTarget] = useState<ArtifactCanvasTarget | null>(() =>
    autoCanvas ? canvasTargetFor(props.fixture) : null,
  );
  return (
    <section
      style={CASE_STYLE}
      data-testid="artifact-gallery-case"
      data-fixture-id={props.fixture.id}
    >
      <h3 style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--muted)' }}>
        {props.fixture.title}
      </h3>
      <MediaPreviewReadProvider sessionId={ARTIFACT_GALLERY_SESSION} readMedia={readGalleryMedia}>
        <MarkdownView
          text={props.fixture.markdown}
          renderingPhase="completed"
          locale="en"
          artifactOrigin={{ sessionId: ARTIFACT_GALLERY_SESSION, messageId: props.fixture.id }}
          onOpenArtifactCanvas={(target) => setCanvasTarget(target)}
        />
      </MediaPreviewReadProvider>
      {canvasTarget ? (
        <div data-testid="artifact-gallery-canvas-stage" style={CANVAS_STAGE_STYLE}>
          <ArtifactCanvasPanel activeTarget={canvasTarget} />
        </div>
      ) : null}
    </section>
  );
}

function ArtifactStreamingCase(): ReactElement {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STREAMING_DELTA_STEPS[stepIndex] ?? STREAMING_DELTA_STEPS[0];
  if (!step) throw new Error('missing streaming fixture');
  const lastIndex = STREAMING_DELTA_STEPS.length - 1;
  return (
    <section style={CASE_STYLE} data-testid="artifact-gallery-case" data-fixture-id="streaming">
      <h3 style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--muted)' }}>
        Streaming deltas
      </h3>
      <button
        type="button"
        data-testid="artifact-gallery-stream-next"
        disabled={stepIndex >= lastIndex}
        onClick={() => setStepIndex((current) => Math.min(lastIndex, current + 1))}
      >
        Next delta
      </button>
      <MarkdownView
        text={step.text}
        renderingPhase={step.phase}
        locale="en"
        artifactOrigin={{ sessionId: ARTIFACT_GALLERY_SESSION, messageId: 'streaming' }}
      />
    </section>
  );
}


const SLOW_STREAM_HTML = [
  '<style>',
  '.wrap{width:100%;max-width:100%;min-width:0;box-sizing:border-box;container-type:inline-size}',
  '.title{display:flex;align-items:center;gap:8px;font-size:20px;font-weight:700;color:#b5412c;margin:0 0 16px}',
  '.grid{display:grid;grid-template-columns:1fr;gap:16px}',
  '@container (min-width:560px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}',
  '.card{border:1px solid rgba(127,127,127,.3);border-radius:10px;padding:16px}',
  '.tag{display:inline-block;background:#b5412c;color:#fff;font-size:12px;font-weight:700;padding:2px 8px;border-radius:4px}',
  '.card h3{font-size:16px;margin:10px 0 6px}',
  '.card p{font-size:13.5px;line-height:1.7;margin:0}',
  '.card ul{margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.7}',
  '.flow{margin-top:18px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
  '.step{padding:6px 10px;border-radius:6px;background:rgba(127,127,127,.15);font-size:12.5px}',
  '</style>',
  '<div class="wrap">',
  '  <div class="title">HTTPS 抵御劫持的“三大铁律”</div>',
  '  <div class="grid">',
  ...['一', '二', '三'].flatMap((n) => [
    '    <div class="card">',
    `      <span class="tag">第${n}道防线</span>`,
    '      <h3>内容加密：防窃听</h3>',
    '      <p>运营商或中间人即使截获了数据包，看到的也只是经过对称加密后的密文，无法读取页面内容，也就无法在其中插入广告或脚本。</p>',
    '      <ul><li>非对称加密协商会话密钥</li><li>对称加密传输正文</li><li>前向保密防止事后解密</li></ul>',
    '    </div>',
  ]),
  '  </div>',
  '  <div class="flow"><span class="step">ClientHello</span><span class="step">ServerHello + 证书</span><span class="step">密钥交换</span><span class="step">加密通信</span></div>',
  '</div>',
].join('\n');

const SLOW_STREAM_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">',
  '  <!-- Sky and ground -->',
  '  <defs>',
  '    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">',
  '      <stop offset="0%" stop-color="#87ceeb"/>',
  '      <stop offset="100%" stop-color="#e0f6ff"/>',
  '    </linearGradient>',
  '  </defs>',
  '  <rect width="400" height="300" fill="url(#sky)"/>',
  '  <rect y="240" width="400" height="60" fill="#8fbc8f"/>',
  '  <circle cx="130" cy="220" r="40" fill="none" stroke="#333" stroke-width="6"/>',
  '  <circle cx="280" cy="220" r="40" fill="none" stroke="#333" stroke-width="6"/>',
  '  <path d="M130 220 L200 160 L280 220 M200 160 L240 160" stroke="#c0392b" stroke-width="6" fill="none"/>',
  '  <ellipse cx="210" cy="120" rx="45" ry="28" fill="#fff" stroke="#999"/>',
  '  <path d="M250 105 L320 118 L250 125 Z" fill="#f39c12"/>',
  '  <text x="200" y="40" text-anchor="middle" font-size="18" fill="#2c3e50">Pelican on a bicycle</text>',
  '</svg>',
].join('\n');

/** `?id=slow-stream&tps=15&fence=html` — token-paced stream for live-render diagnosis. */
function ArtifactSlowStreamCase(props: { tps: number; fence: string; paper: boolean; script: boolean }): ReactElement {
  const SOURCE = props.fence === 'svg' ? SLOW_STREAM_SVG : props.script ? `${SLOW_STREAM_HTML}\n<script>document.querySelectorAll('.card').forEach(function(c){c.onclick=function(){c.classList.toggle('on')}})</script>` : SLOW_STREAM_HTML;
  const artifactTheme = useMemo(() => (props.paper ? createDefaultArtifactTheme('light') : undefined), [props.paper]);
  useEffect(() => {
    if (!props.paper) return;
    document.documentElement.setAttribute('data-theme-id', 'piwin-inkstone-paper');
    document.documentElement.setAttribute('data-theme-mode', 'light');
  }, [props.paper]);
  const prefix = `以下是原理拆解：\n\n\`\`\`${props.fence}\n`;
  const suffix = '\n```\n\n以上就是 HTTPS 的三道防线。\n';
  const [chars, setChars] = useState(0);
  const done = chars >= SOURCE.length;
  useEffect(() => {
    if (done) return;
    const charsPerToken = 2.2;
    const timer = window.setTimeout(
      () => setChars((current) => Math.min(SOURCE.length, current + Math.ceil(charsPerToken))),
      1000 / props.tps,
    );
    return () => window.clearTimeout(timer);
  }, [chars, done, props.tps]);
  const text = `${prefix}${SOURCE.slice(0, chars)}${done ? suffix : ''}`;
  return (
    <section style={CASE_STYLE} data-testid="artifact-gallery-case" data-fixture-id="slow-stream">
      <h3 data-testid="slow-stream-progress" data-done={done ? 'true' : 'false'} style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--muted)' }}>
        {chars}/{SOURCE.length} chars @ {props.tps} tps
      </h3>
      <MarkdownView
        text={text}
        renderingPhase={done ? 'completed' : 'streaming'}
        locale="zh-CN"
        {...(artifactTheme ? { artifactTheme } : {})}
        artifactOrigin={{ sessionId: ARTIFACT_GALLERY_SESSION, messageId: 'slow-stream' }}
      />
    </section>
  );
}

function isFixtureId(value: string): value is ArtifactFixtureId {
  return ARTIFACT_FIXTURES.some((fixture) => fixture.id === value);
}

export function ArtifactGallery(): ReactElement {
  const selection = useMemo(() => readGallerySelection(), []);
  const constrainedPane = window.location.hash.includes('&pane=1');
  if (selection === 'code-preview') return <CodePreviewGallery />;
  if (selection === 'slow-stream') {
    const params = new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf('?') + 1));
    return (
      <div style={GALLERY_ROOT_STYLE} data-testid="artifact-gallery">
        <ArtifactSlowStreamCase tps={Number(params.get('tps') ?? 15)} fence={params.get('fence') ?? 'html'} paper={params.get('theme') === 'paper'} script={params.get('script') === '1'} />
      </div>
    );
  }
  const cases: ArtifactFixture[] =
    selection && isFixtureId(selection) ? [getArtifactFixture(selection)] : [...ARTIFACT_FIXTURES];
  const showStreaming = selection === null || selection === 'streaming';

  return (
    <div
      style={{ ...GALLERY_ROOT_STYLE, ...(constrainedPane ? { height: 500, minHeight: 0 } : {}) }}
      className={constrainedPane ? 'conversation-pane-session' : undefined}
      data-testid="artifact-gallery"
    >
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '24px' }}>
        <a href="#/e2e/artifacts" data-testid="artifact-gallery-link-all">
          All
        </a>
        {ARTIFACT_FIXTURES.map((fixture) => (
          <a
            key={fixture.id}
            href={`#/e2e/artifacts?id=${fixture.id}`}
            data-testid={`artifact-gallery-link-${fixture.id}`}
          >
            {fixture.title}
          </a>
        ))}
        <a href="#/e2e/artifacts?id=streaming" data-testid="artifact-gallery-link-streaming">
          Streaming
        </a>
      </nav>
      {showStreaming && selection === 'streaming' ? <ArtifactStreamingCase /> : null}
      {cases.map((fixture) => (
        <ArtifactGalleryCase key={fixture.id} fixture={fixture} />
      ))}
      {showStreaming && selection === null ? <ArtifactStreamingCase /> : null}
    </div>
  );
}
