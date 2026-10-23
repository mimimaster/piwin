// @vitest-environment happy-dom
/**
 * Idle tool card: four launchers, working-tree stat on Changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostResponse } from '@piwin/contracts';
import { StageToolCard } from './stage-tool-card';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function diffResponse(additions: number, deletions: number): HostResponse {
  return {
    type: 'response',
    command: 'git/diff-summary',
    success: true,
    data: { summary: { totalAdditions: additions, totalDeletions: deletions } },
  } as HostResponse;
}

async function renderCard(
  props: Partial<Parameters<typeof StageToolCard>[0]> = {},
): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  const nextRoot = createRoot(host);
  root = nextRoot;
  await act(async () => {
    nextRoot.render(
      <StageToolCard
        locale="zh-CN"
        projectPath="/Users/me/piwin"
        request={async () => diffResponse(0, 0)}
        onOpenTool={() => {}}
        {...props}
      />,
    );
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('StageToolCard', () => {
  it('lists Changes, Browser, Terminal, Files in order', async () => {
    const host = await renderCard();
    const labels = [...host.querySelectorAll('.stage-tool-card-label')].map((n) => n.textContent);
    expect(labels).toEqual(['变更', '浏览器', '终端', '文件']);
    expect(host.querySelector('.stage-tool-dock > [data-testid="stage-tool-card"]')).not.toBeNull();
  });

  it('shows the working-tree size on Changes', async () => {
    const host = await renderCard({ request: async () => diffResponse(2613, 1290) });
    expect(host.querySelector('[data-testid="stage-tool-card-stat"]')?.textContent).toBe(
      '+2613−1290',
    );
    expect(host.querySelector('[data-testid="stage-tool-card-review"]')?.getAttribute('title')).toBe(
      '变更 +2613 −1290',
    );
  });

  it('skips git outside a project', async () => {
    const request = vi.fn(async () => diffResponse(1, 1));
    const host = await renderCard({ projectPath: null, request });
    expect(request).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="stage-tool-card-stat"]')).toBeNull();
  });

  it('opens the picked tool', async () => {
    const onOpenTool = vi.fn();
    const host = await renderCard({ onOpenTool });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="stage-tool-card-browser"]')?.click());
    expect(onOpenTool).toHaveBeenCalledWith('browser');
  });
});
