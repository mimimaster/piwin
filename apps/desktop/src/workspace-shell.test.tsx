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
      '<div class="chat-stage"><div data-slot="transcript"></div><div data-slot="composer"></div></div>',
    );
    expect(markup).not.toContain('telemetry');
  });
});
