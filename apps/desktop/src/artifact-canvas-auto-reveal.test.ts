import { describe, expect, it } from 'vitest';
import {
  advanceArtifactCanvasAutoReveal,
  createArtifactCanvasAutoRevealState,
  type ArtifactCanvasAutoRevealInput,
  type ArtifactCanvasAutoRevealState,
} from './artifact-canvas-auto-reveal';

const CANVAS_MARKDOWN = [
  '```artifact-html title="Prototype" surface="canvas"',
  '<main>prototype</main>',
  '```',
].join('\n');

const INLINE_MARKDOWN = [
  '```artifact-html title="Reference"',
  '<section>reference</section>',
  '```',
].join('\n');

const TWO_CANVAS_MARKDOWN = [
  '```artifact-html title="First workspace" surface="canvas"',
  '<main>first</main>',
  '```',
  '',
  '```artifact-html title="Last workspace" surface="canvas"',
  '<main>last</main>',
  '```',
].join('\n');

const BLOCKED_CANVAS_MARKDOWN = [
  '```artifact-html title="Remote" surface="canvas"',
  '<iframe src="https://example.com"></iframe>',
  '```',
].join('\n');

function step(
  state: ArtifactCanvasAutoRevealState,
  input: Partial<ArtifactCanvasAutoRevealInput> & {
    status?: 'streaming' | 'done' | 'error';
    text?: string;
    id?: string;
  } = {},
) {
  const status = input.status ?? 'done';
  const text = input.text ?? CANVAS_MARKDOWN;
  return advanceArtifactCanvasAutoReveal(state, {
    sessionId: input.sessionId ?? 'session-1',
    messages: input.messages ?? [
      { id: input.id ?? 'message-1', role: 'assistant', status, text },
    ],
    enabled: input.enabled ?? true,
    ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
  });
}

describe('Artifact Canvas automatic reveal', () => {
  it('ignores completed history that was never observed streaming', () => {
    const result = step(createArtifactCanvasAutoRevealState(), { status: 'done' });
    expect(result.target).toBeNull();
  });

  it('reveals a Canvas once when a live message completes', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), { status: 'streaming' });
    const completed = step(streaming.state, { status: 'done' });
    const repeated = step(completed.state, { status: 'done' });

    expect(completed.target).toMatchObject({
      id: 'canvas:session-1:message-1:0',
      title: 'Prototype',
      surface: 'canvas',
    });
    expect(repeated.target).toBeNull();
  });

  it('does not reveal an Inline Artifact after completion', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), {
      status: 'streaming',
      text: INLINE_MARKDOWN,
    });
    const completed = step(streaming.state, { status: 'done', text: INLINE_MARKDOWN });
    expect(completed.target).toBeNull();
  });

  it('opens the last Canvas fence when a message contains several', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), {
      status: 'streaming',
      text: TWO_CANVAS_MARKDOWN,
    });
    const completed = step(streaming.state, { status: 'done', text: TWO_CANVAS_MARKDOWN });
    expect(completed.target).toMatchObject({
      id: 'canvas:session-1:message-1:1',
      title: 'Last workspace',
      fenceIndex: 1,
    });
  });

  it('does not reveal a blocked Canvas declaration', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), {
      status: 'streaming',
      text: BLOCKED_CANVAS_MARKDOWN,
    });
    const completed = step(streaming.state, { status: 'done', text: BLOCKED_CANVAS_MARKDOWN });
    expect(completed.target).toBeNull();
  });

  it('consumes completion on error without opening Canvas', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), { status: 'streaming' });
    const errored = step(streaming.state, { status: 'error' });
    const laterDone = step(errored.state, { status: 'done' });
    expect(errored.target).toBeNull();
    expect(laterDone.target).toBeNull();
  });

  it('consumes completion while automatic reveal is disabled', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), { status: 'streaming' });
    const disabled = step(streaming.state, { status: 'done', enabled: false });
    const enabledLater = step(disabled.state, { status: 'done' });
    expect(disabled.target).toBeNull();
    expect(enabledLater.target).toBeNull();
  });

  it('clears pending identity when the active session changes', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), { status: 'streaming' });
    const switched = step(streaming.state, { status: 'done', sessionId: 'session-2' });
    expect(switched.target).toBeNull();
  });

  it('keeps the launcher target id stable with the live auto-reveal id', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), { status: 'streaming' });
    const completed = step(streaming.state, { status: 'done' });
    expect(completed.target?.id).toBe('canvas:session-1:message-1:0');
  });

  it('ArtifactCanvasAutoRevealInput has no artifactCodeFirst field', () => {
    const input: ArtifactCanvasAutoRevealInput = {
      sessionId: 'session-1',
      messages: [],
      enabled: true,
    };
    expect('artifactCodeFirst' in input).toBe(false);
  });
});
