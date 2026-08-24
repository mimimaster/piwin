/**
 * E2E-only Artifact gallery. Reached only through the build-time gated
 * fixture route in DesktopThemeRoot (`VITE_PIWIN_E2E_FIXTURES` + `#/e2e/artifacts`).
 */
import { useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { evaluateCodeFence } from '@piwin/artifact';
import {
  ARTIFACT_FIXTURES,
  STREAMING_DELTA_STEPS,
  getArtifactFixture,
  type ArtifactFixture,
  type ArtifactFixtureId,
} from '@piwin/artifact/fixtures';
import { ArtifactCanvasPanel } from '../artifact-canvas-panel';
import {
  createArtifactCanvasTarget,
  type ArtifactCanvasTarget,
} from '../artifact-canvas-model';
import { MarkdownView } from '../MarkdownView';

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
  const decision = evaluateCodeFence({
    language: fixture.language,
    source: fixture.source,
    id: `${ARTIFACT_GALLERY_SESSION}-${fixture.id}`,
  });
  if (decision.kind !== 'render') return null;
  return createArtifactCanvasTarget({
    sessionId: ARTIFACT_GALLERY_SESSION,
    messageId: fixture.id,
    fenceIndex: 0,
    descriptor: decision.descriptor,
  });
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
      <MarkdownView
        text={props.fixture.markdown}
        renderingPhase="completed"
        locale="en"
        artifactOrigin={{ sessionId: ARTIFACT_GALLERY_SESSION, messageId: props.fixture.id }}
        onOpenArtifactCanvas={(target) => setCanvasTarget(target)}
      />
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

function isFixtureId(value: string): value is ArtifactFixtureId {
  return ARTIFACT_FIXTURES.some((fixture) => fixture.id === value);
}

export function ArtifactGallery(): ReactElement {
  const selection = useMemo(() => readGallerySelection(), []);
  const cases: ArtifactFixture[] =
    selection && isFixtureId(selection) ? [getArtifactFixture(selection)] : [...ARTIFACT_FIXTURES];
  const showStreaming = selection === null || selection === 'streaming';

  return (
    <div style={GALLERY_ROOT_STYLE} data-testid="artifact-gallery">
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
