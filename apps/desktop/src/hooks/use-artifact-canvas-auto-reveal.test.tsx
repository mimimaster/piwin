// @vitest-environment happy-dom
/**
 * Reveal vs update wiring: first live Canvas id opens the inspector once;
 * later tokens and abort must not call onReveal again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatMessageUi } from '../chat-reducer';
import type { ArtifactCanvasTarget } from '../artifact-canvas-model';
import { useArtifactCanvasAutoReveal } from './use-artifact-canvas-auto-reveal';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OPEN_CANVAS = [
  '```artifact-html title="Live" surface="canvas"',
  '<main>partial',
].join('\n');
const GROWN_CANVAS = [
  '```artifact-html title="Live" surface="canvas"',
  '<main>partial grown',
].join('\n');
const CLOSED_CANVAS = [
  '```artifact-html title="Live" surface="canvas"',
  '<main>done</main>',
  '```',
].join('\n');

function assistant(text: string, status: ChatMessageUi['status']): ChatMessageUi {
  return {
    id: 'message-1',
    role: 'assistant',
    text,
    thinking: '',
    tools: [],
    attachments: [],
    status,
  };
}

function Harness(props: {
  messages: readonly ChatMessageUi[];
  runTerminalKind?: 'none' | 'complete' | 'stopped' | 'failed';
  onReveal: (target: ArtifactCanvasTarget) => void;
  onUpdate: (target: ArtifactCanvasTarget) => void;
}): ReactElement {
  useArtifactCanvasAutoReveal({
    activeSessionId: 'session-1',
    messages: props.messages,
    enabled: true,
    onReveal: props.onReveal,
    onUpdate: props.onUpdate,
    ...(props.runTerminalKind !== undefined
      ? { runTerminalKind: props.runTerminalKind }
      : {}),
  });
  return <div />;
}

describe('useArtifactCanvasAutoReveal', () => {
  let previousActEnvironment: boolean | undefined;
  const mounted: Array<{ container: HTMLElement; root: Root }> = [];

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    while (mounted.length > 0) {
      const render = mounted.pop();
      if (!render) continue;
      act(() => {
        render.root.unmount();
      });
      render.container.remove();
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('reveals once then updates source; abort does not commit', () => {
    const onReveal = vi.fn();
    const onUpdate = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });

    act(() => {
      root.render(
        <Harness
          messages={[assistant(OPEN_CANVAS, 'streaming')]}
          onReveal={onReveal}
          onUpdate={onUpdate}
        />,
      );
    });
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onReveal.mock.calls[0]?.[0]).toMatchObject({
      id: 'canvas:session-1:message-1:0',
      streaming: true,
    });

    act(() => {
      root.render(
        <Harness
          messages={[assistant(GROWN_CANVAS, 'streaming')]}
          onReveal={onReveal}
          onUpdate={onUpdate}
        />,
      );
    });
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]?.[0]).toMatchObject({
      id: 'canvas:session-1:message-1:0',
      streaming: true,
    });

    act(() => {
      root.render(
        <Harness
          messages={[assistant(GROWN_CANVAS, 'done')]}
          runTerminalKind="stopped"
          onReveal={onReveal}
          onUpdate={onUpdate}
        />,
      );
    });
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('commits on successful completion with an update, not a second reveal', () => {
    const onReveal = vi.fn();
    const onUpdate = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });

    act(() => {
      root.render(
        <Harness
          messages={[assistant(OPEN_CANVAS, 'streaming')]}
          onReveal={onReveal}
          onUpdate={onUpdate}
        />,
      );
    });
    act(() => {
      root.render(
        <Harness
          messages={[assistant(CLOSED_CANVAS, 'done')]}
          runTerminalKind="complete"
          onReveal={onReveal}
          onUpdate={onUpdate}
        />,
      );
    });
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]?.[0].streaming).toBeUndefined();
  });
});
