// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceShell } from './workspace-shell.js';

describe('WorkspaceShell', () => {
  it('keeps the Composer as the final element in the chat stage', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell
        titlebar={<div data-slot="titlebar" />}
        sidebar={<div data-slot="sidebar" />}
        transcript={<div data-slot="transcript" />}
        composerDock={<div data-slot="composer" />}
        rightPanel={<div data-slot="inspector" />}
      />,
    );

    expect(markup).toContain(
      '<div class="chat-stage"><div class="conversation-desktop-surface"><div data-slot="transcript"></div><div data-slot="composer"></div></div></div>',
    );
    expect(markup).not.toContain('telemetry');
  });
});

it('keeps the same transcript and draft DOM when switching either shell', () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (cli: boolean) => act(() => root.render(<WorkspaceShell titlebar={null} sidebar={null}
    rightPanel={null} transcript={<div data-testid="history" />} composerDock={<textarea defaultValue="draft" />}
    conversationOverride={<div hidden={!cli} data-testid="terminal" />} conversationOverrideActive={cli} />));
  try {
    render(false);
    const input = container.querySelector('textarea');
    const transcript = container.querySelector('[data-testid="history"]');
    if (input === null) throw new Error('Draft missing');
    input.value = 'unsent text';
    render(true);
    expect(input.closest('[hidden]')).not.toBeNull();
    render(false);
    expect(container.querySelector('textarea')).toBe(input);
    expect(input.value).toBe('unsent text');
    expect(container.querySelector('[data-testid="history"]')).toBe(transcript);
  } finally { act(() => root.unmount()); container.remove(); }
});
