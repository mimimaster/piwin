import { describe, expect, it } from 'vitest';
import { createArtifactFenceRecord } from '../src/fence-index.js';
import { analyzeArtifactFence } from '../src/render-intent.js';
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

  it('records the current flashcard tool-result structured payload', () => {
    expect(FLASHCARD_TOOL_RESULT.ok).toBe(true);
    const parsed = JSON.parse(FLASHCARD_TOOL_RESULT.output) as {
      card: { id: string };
      duplicate: boolean;
      display: { cards: Array<{ cardId: string; front: string; back: string }> };
      artifactHtml?: unknown;
    };
    expect(parsed.card.id).toBe(FLASHCARD_TOOL_RESULT.parsed.card.id);
    expect(parsed.duplicate).toBe(false);
    expect(parsed.artifactHtml).toBeUndefined();
    expect(parsed.display.cards).toHaveLength(1);
    expect(parsed.display.cards[0]?.cardId).toBe(parsed.card.id);
    expect(parsed.display.cards[0]?.front).toBe('What is an Artifact?');
    expect(parsed.display.cards[0]?.back).toBe('Untrusted HTML rendered in a sandbox.');
    expect(getArtifactFixture('flashcard-tool-result').source).toBe(FLASHCARD_TOOL_RESULT.output);
    expect(getArtifactFixture('flashcard-tool-result').language).toBe('json');
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

  it('keeps current analyze routing stable for each HTML shape', () => {
    const routing: Record<string, string> = {};
    for (const id of REQUIRED_IDS) {
      const fixture = getArtifactFixture(id);
      if (id === 'flashcard-tool-result') continue;
      const analysis = analyzeArtifactFence(
        createArtifactFenceRecord({ info: fixture.language, source: fixture.source }),
        { id: `fixture-${id}`, htmlUiModeEnabled: true },
      );
      if (analysis.kind !== 'intent') {
        routing[id] = analysis.kind === 'blocked' ? `blocked:${analysis.reason}` : analysis.kind;
        continue;
      }
      routing[id] = `${analysis.intent.layout}:${analysis.intent.renderer}`;
    }

    expect(routing['inert-fragment']).toBe('flow:static');
    expect(routing['script-fragment']).toBe('flow:sandbox');
    expect(routing['native-svg']).toBe('flow:static');
    expect(routing['full-html-document']).toBe('viewport:sandbox');
    expect(routing['viewport-100vh']).toBe('viewport:sandbox');
    expect(routing['local-fixed-toast']).toBe('flow:static');
    expect(routing['four-edge-fixed-shell']).toBe('viewport:sandbox');
    expect(routing['flow-6000']).toBe('flow:sandbox');
    expect(routing['overflow-20000']).toBe('flow:sandbox');
    expect(routing['explicit-canvas']).toBe('canvas:sandbox');
    expect(routing['blocked-external']).toBe('blocked:blocked-external-resource');
  });
});
