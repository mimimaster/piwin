import { describe, expect, it } from 'vitest';
import {
  advanceArtifactCanvasAutoReveal,
  createArtifactCanvasAutoRevealState,
  type ArtifactCanvasAutoRevealInput,
  type ArtifactCanvasAutoRevealState,
} from './artifact-canvas-auto-reveal';
import type { RunTerminalState } from './chat-reducer';

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

const OPEN_CANVAS_MARKDOWN = [
  '```artifact-html title="Live pelican" surface="canvas"',
  '<!DOCTYPE html>',
  '<html lang="zh"><body><div class="scene">',
].join('\n');

const OPEN_CANVAS_GROWN = [
  '```artifact-html title="Live pelican" surface="canvas"',
  '<!DOCTYPE html>',
  '<html lang="zh"><body><div class="scene"><div class="sun"></div>',
].join('\n');

function step(
  state: ArtifactCanvasAutoRevealState,
  input: Partial<ArtifactCanvasAutoRevealInput> & {
    status?: 'streaming' | 'done' | 'error';
    text?: string;
    id?: string;
    runTerminalKind?: RunTerminalState['kind'];
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
    ...(input.runTerminalKind !== undefined
      ? { runTerminalKind: input.runTerminalKind }
      : {}),
  });
}

describe('Artifact Canvas automatic reveal', () => {
  it('ignores completed history that was never observed streaming', () => {
    const result = step(createArtifactCanvasAutoRevealState(), { status: 'done' });
    expect(result.target).toBeNull();
    expect(result.action).toBeNull();
  });

  it('reveals a live Canvas as soon as surface=canvas is parseable', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), {
      status: 'streaming',
      text: OPEN_CANVAS_MARKDOWN,
    });
    expect(streaming.action).toBe('reveal');
    expect(streaming.target).toMatchObject({
      id: 'canvas:session-1:message-1:0',
      title: 'Live pelican',
      surface: 'canvas',
      streaming: true,
    });
    expect(streaming.target?.source).toContain('<div class="scene">');
  });

  it('updates the same live target as source grows, without a second reveal', () => {
    const first = step(createArtifactCanvasAutoRevealState(), {
      status: 'streaming',
      text: OPEN_CANVAS_MARKDOWN,
    });
    const grown = step(first.state, { status: 'streaming', text: OPEN_CANVAS_GROWN });
    expect(grown.action).toBe('update');
    expect(grown.target?.id).toBe(first.target?.id);
    expect(grown.target?.streaming).toBe(true);
    expect(grown.target?.source).toContain('<div class="sun">');
  });

  it('commits the same target on completion (update, not a second reveal)', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), { status: 'streaming' });
    const completed = step(streaming.state, { status: 'done' });
    const repeated = step(completed.state, { status: 'done' });

    expect(streaming.action).toBe('reveal');
    expect(streaming.target?.streaming).toBe(true);
    expect(completed.action).toBe('update');
    expect(completed.target).toMatchObject({
      id: 'canvas:session-1:message-1:0',
      title: 'Prototype',
      surface: 'canvas',
    });
    expect(completed.target?.streaming).toBeUndefined();
    expect(repeated.target).toBeNull();
    expect(repeated.action).toBeNull();
  });

  it('replaces a live open Canvas fence with a partial-preview warning on completion', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), {
      status: 'streaming',
      text: OPEN_CANVAS_MARKDOWN,
    });
    const completed = step(streaming.state, {
      status: 'done',
      text: OPEN_CANVAS_MARKDOWN,
    });

    expect(completed.action).toBe('update');
    expect(completed.target?.id).toBe(streaming.target?.id);
    expect(completed.target?.streaming).toBeUndefined();
    expect(completed.target?.sourceIncomplete).toBe(true);
  });

  it('does not reveal an Inline Artifact while live or after completion', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), {
      status: 'streaming',
      text: INLINE_MARKDOWN,
    });
    const completed = step(streaming.state, { status: 'done', text: INLINE_MARKDOWN });
    expect(streaming.target).toBeNull();
    expect(completed.target).toBeNull();
  });

  it('opens the last Canvas fence when a message contains several', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), {
      status: 'streaming',
      text: TWO_CANVAS_MARKDOWN,
    });
    expect(streaming.action).toBe('reveal');
    expect(streaming.target).toMatchObject({
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
    expect(streaming.target).toBeNull();
    expect(completed.target).toBeNull();
  });

  it('does not reveal a second time after error', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), { status: 'streaming' });
    expect(streaming.action).toBe('reveal');
    const errored = step(streaming.state, { status: 'error' });
    const laterDone = step(errored.state, { status: 'done' });
    expect(errored.target).toBeNull();
    expect(laterDone.target).toBeNull();
  });

  it('does not commit stream-preview when abort stamps the row done', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), {
      status: 'streaming',
      text: OPEN_CANVAS_MARKDOWN,
    });
    expect(streaming.action).toBe('reveal');
    expect(streaming.target?.streaming).toBe(true);
    const aborted = step(streaming.state, {
      status: 'done',
      text: OPEN_CANVAS_MARKDOWN,
      runTerminalKind: 'stopped',
    });
    const laterDone = step(aborted.state, {
      status: 'done',
      text: OPEN_CANVAS_MARKDOWN,
    });
    expect(aborted.action).toBeNull();
    expect(aborted.target).toBeNull();
    expect(aborted.state.liveTargetId).toBe(streaming.target?.id ?? null);
    expect(laterDone.target).toBeNull();
  });

  it('does not reveal while automatic reveal is disabled', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), {
      status: 'streaming',
      enabled: false,
    });
    const disabled = step(streaming.state, { status: 'done', enabled: false });
    const enabledLater = step(disabled.state, { status: 'done' });
    expect(streaming.target).toBeNull();
    expect(disabled.target).toBeNull();
    expect(enabledLater.target).toBeNull();
  });

  it('clears pending identity when the active session changes', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), { status: 'streaming' });
    const switched = step(streaming.state, { status: 'done', sessionId: 'session-2' });
    expect(switched.target).toBeNull();
    expect(switched.state.liveTargetId).toBeNull();
  });

  it('keeps the launcher target id stable with the live auto-reveal id', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), { status: 'streaming' });
    expect(streaming.target?.id).toBe('canvas:session-1:message-1:0');
  });

  it('reveals on completion when Canvas only becomes parseable after streaming observation', () => {
    const streaming = step(createArtifactCanvasAutoRevealState(), {
      status: 'streaming',
      text: 'thinking',
    });
    expect(streaming.target).toBeNull();
    const completed = step(streaming.state, { status: 'done', text: CANVAS_MARKDOWN });
    expect(completed.action).toBe('reveal');
    expect(completed.target?.id).toBe('canvas:session-1:message-1:0');
    expect(completed.target?.streaming).toBeUndefined();
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
