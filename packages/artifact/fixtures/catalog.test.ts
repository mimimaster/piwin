import { describe, expect, it } from 'vitest';
import { evaluateCodeFence } from '../src/evaluate.js';
import { resolveArtifactPresentation } from '../src/presentation-policy.js';
import {
  ARTIFACT_FIXTURE_IDS,
  ARTIFACT_TRAILING_MARKDOWN,
  FLASHCARD_TOOL_RESULT,
  STREAMING_DELTA_STEPS,
  getArtifactFixture,
} from './index.js';

const REQUIRED_IDS = [
  'inert-fragment',
  'script-fragment',
  'native-svg',
  'full-html-document',
  'viewport-100vh',
  'local-fixed-toast',
  'four-edge-fixed-shell',
  'flow-6000',
  'overflow-20000',
  'explicit-canvas',
  'blocked-external',
  'flashcard-tool-result',
] as const;

const SCROLLABLE_IDS = [
  'inert-fragment',
  'script-fragment',
  'flow-6000',
  'overflow-20000',
  'full-html-document',
  'viewport-100vh',
  'four-edge-fixed-shell',
  'explicit-canvas',
] as const;

describe('artifact rendering fixtures', () => {
  it('covers every required fixture shape', () => {
    expect([...ARTIFACT_FIXTURE_IDS]).toEqual([...REQUIRED_IDS]);
    for (const id of REQUIRED_IDS) {
      const fixture = getArtifactFixture(id);
      expect(fixture.id).toBe(id);
      expect(fixture.source.length).toBeGreaterThan(0);
      expect(fixture.markdown).toContain(ARTIFACT_TRAILING_MARKDOWN);
      expect(fixture.markdown.endsWith(`${ARTIFACT_TRAILING_MARKDOWN}\n`)).toBe(true);
    }
  });

  it('puts a unique [data-artifact-end] node last in every scrollable HTML fixture', () => {
    const seen = new Set<string>();
    for (const id of SCROLLABLE_IDS) {
      const fixture = getArtifactFixture(id);
      expect(fixture.scrollable).toBe(true);
      const matches = [...fixture.source.matchAll(/data-artifact-end="([^"]+)"/g)].map(
        (match) => match[1],
      );
      expect(matches).toEqual([id]);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      const endIndex = fixture.source.lastIndexOf(`data-artifact-end="${id}"`);
      const afterEnd = fixture.source.slice(endIndex);
      expect(afterEnd).not.toMatch(/<(?:div|section|main|header|footer|p|button)\b/i);
    }
  });

  it('uses canonical fence languages for explicit vs native artifacts', () => {
    expect(getArtifactFixture('inert-fragment').language.startsWith('artifact-html')).toBe(true);
    expect(getArtifactFixture('script-fragment').language.startsWith('artifact-html')).toBe(true);
    expect(getArtifactFixture('native-svg').language).toBe('svg');
    expect(getArtifactFixture('full-html-document').language).toBe('html');
    expect(getArtifactFixture('explicit-canvas').language).toContain('surface="canvas"');
    expect(getArtifactFixture('explicit-canvas').language.startsWith('artifact-html')).toBe(true);
  });

  it('records the current flashcard tool-result artifactHtml payload', () => {
    expect(FLASHCARD_TOOL_RESULT.ok).toBe(true);
    const parsed = JSON.parse(FLASHCARD_TOOL_RESULT.output) as {
      card: { id: string };
      duplicate: boolean;
      artifactHtml: string;
    };
    expect(parsed.card.id).toBe(FLASHCARD_TOOL_RESULT.parsed.card.id);
    expect(parsed.duplicate).toBe(false);
    expect(parsed.artifactHtml).toContain('piwin-flashcard');
    expect(parsed.artifactHtml).toContain(`data-card-id="${parsed.card.id}"`);
    expect(getArtifactFixture('flashcard-tool-result').source).toBe(parsed.artifactHtml);
  });

  it('records streaming deltas from partial tokens to a final fenced document', () => {
    expect(STREAMING_DELTA_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(STREAMING_DELTA_STEPS[0]?.phase).toBe('streaming');
    expect(STREAMING_DELTA_STEPS[STREAMING_DELTA_STEPS.length - 1]?.phase).toBe('completed');
    const last = STREAMING_DELTA_STEPS[STREAMING_DELTA_STEPS.length - 1];
    expect(last?.text).toContain('```artifact-html');
    expect(last?.text).toContain('data-artifact-end="streaming-script"');
    expect(last?.text).toContain(ARTIFACT_TRAILING_MARKDOWN);
    expect(STREAMING_DELTA_STEPS[0]?.text.includes('```\n')).toBe(false);
  });

  it('keeps current evaluate/presentation routing stable for each HTML shape', () => {
    const routing: Record<string, string> = {};
    for (const id of REQUIRED_IDS) {
      const fixture = getArtifactFixture(id);
      if (id === 'flashcard-tool-result') continue;
      const decision = evaluateCodeFence({
        language: fixture.language,
        source: fixture.source,
        id: `fixture-${id}`,
      });
      if (decision.kind !== 'render') {
        routing[id] =
          decision.kind === 'blocked' ? `blocked:${decision.reason}` : decision.kind;
        continue;
      }
      const presentation = resolveArtifactPresentation({
        descriptor: decision.descriptor,
        mode: decision.mode,
        source: decision.renderSource,
      });
      routing[id] =
        presentation.kind === 'source'
          ? `source:${presentation.previewSurface}`
          : presentation.kind === 'inline-incompatible'
            ? `inline-incompatible:${presentation.issues.join(',')}`
            : presentation.kind;
    }

    expect(routing['inert-fragment']).toBe('inline-static');
    expect(routing['script-fragment']).toBe('inline-sandbox');
    expect(routing['native-svg']).toBe('source:inline');
    expect(routing['full-html-document']).toBe('source:canvas');
    expect(routing['viewport-100vh']).toMatch(/^inline-incompatible:/);
    expect(routing['local-fixed-toast']).toMatch(/^inline-incompatible:/);
    expect(routing['four-edge-fixed-shell']).toMatch(/^inline-incompatible:/);
    expect(routing['flow-6000']).toBe('inline-sandbox');
    expect(routing['overflow-20000']).toBe('inline-sandbox');
    expect(routing['explicit-canvas']).toBe('canvas');
    expect(routing['blocked-external']).toBe('blocked:blocked-external-resource');
  });
});
