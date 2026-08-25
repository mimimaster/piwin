import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceShell } from './workspace-shell.js';

describe('WorkspaceShell', () => {
  it('keeps telemetry immediately after the Composer inside the chat stage', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell
        titlebar={<div data-slot="titlebar" />}
        sidebar={<div data-slot="sidebar" />}
        transcript={<div data-slot="transcript" />}
        composerDock={<div data-slot="composer" />}
        statusBar={<div data-slot="telemetry" />}
        rightPanel={<div data-slot="inspector" />}
      />,
    );

    expect(markup).toContain(
      '<div class="chat-stage"><div data-slot="transcript"></div><div data-slot="composer"></div><div data-slot="telemetry"></div></div>',
    );
  });
});
