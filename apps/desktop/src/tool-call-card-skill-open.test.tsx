// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { ToolCardUi } from './chat-reducer';
import { ToolCallCard } from './tool-call-card';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createSkillReadTool(): ToolCardUi {
  return {
    toolCallId: 'piw-t-skill-read',
    toolName: 'read',
    status: 'done',
    output: '',
    presentation: {
      title: 'read',
      kind: 'filesystem',
      actionVerb: 'Read',
      summary: 'SKILL.md',
      targetPaths: ['/Users/me/.piwin-test/skills/imagegen/SKILL.md'],
      documentTargets: [{ kind: 'skill', skillId: 'imagegen', displayRef: 'skill:imagegen' }],
    },
  };
}

describe('ToolCallCard skill document open', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('opens a collapsed skill read through onOpenDocument with tool identity', () => {
    const onOpenDocument = vi.fn();
    const onOpenFile = vi.fn();

    act(() => {
      root.render(
        <ToolCallCard
          tool={createSkillReadTool()}
          projectPath="/Users/me/Developer/CCursor"
          density="comfortable"
          onOpenFile={onOpenFile}
          onOpenDocument={onOpenDocument}
        />,
      );
    });

    act(() => {
      container.querySelector<HTMLElement>('[data-testid="tool-call-file-pill"]')?.click();
    });

    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onOpenDocument).toHaveBeenCalledWith({
      title: 'imagegen',
      path: '/Users/me/.piwin-test/skills/imagegen/SKILL.md',
      target: { kind: 'skill', skillId: 'imagegen', displayRef: 'skill:imagegen' },
      toolCallId: 'piw-t-skill-read',
    });
  });

  it('still uses onOpenFile when Doc Preview is not wired', () => {
    const onOpenFile = vi.fn();

    act(() => {
      root.render(
        <ToolCallCard
          tool={createSkillReadTool()}
          projectPath="/Users/me/Developer/CCursor"
          density="comfortable"
          onOpenFile={onOpenFile}
        />,
      );
    });

    act(() => {
      container.querySelector<HTMLElement>('[data-testid="tool-call-file-pill"]')?.click();
    });

    expect(onOpenFile).toHaveBeenCalledWith(
      '/Users/me/.piwin-test/skills/imagegen/SKILL.md',
      '/Users/me/.piwin-test/skills/imagegen/SKILL.md',
    );
  });
});
