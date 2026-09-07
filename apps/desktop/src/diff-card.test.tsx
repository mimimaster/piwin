// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { GitFileDiff, HostResponse } from '@piwin/contracts';
import { DiffCard, diffLineStats } from './diff-card';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('diffLineStats', () => {
  it('counts add/del lines excluding file headers', () => {
    const diff = [
      '--- a/settings-shell.tsx',
      '+++ b/settings-shell.tsx',
      '@@ -41,2 +42,5 @@',
      ' export function SettingsShell() {',
      "-  const [page, setPage] = useState('general')",
      '+  return (',
      '+    <Routes base="/settings">',
    ].join('\n');
    expect(diffLineStats(diff)).toEqual({ adds: 2, dels: 1 });
  });

  it('handles empty diff', () => {
    expect(diffLineStats('')).toEqual({ adds: 0, dels: 0 });
  });
});

describe('DiffCard component (proto-01 alignment)', () => {
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

  const samplePatch = [
    '--- a/composer-run-actions.tsx',
    '+++ b/composer-run-actions.tsx',
    '@@ -85,7 +85,9 @@ resolvePrimaryAction(input)',
    '   if (streaming) {',
    "-    return { kind: 'pause', label: t.pause };",
    "+    if (draft.trim()) return { kind: 'queue', label: t.queueFollowUp };",
    "+    return { kind: 'pause', label: t.pause };",
    '   }',
  ].join('\n');

  const fileDiff: GitFileDiff = {
    repository: { rootPath: '/workspace', isRepository: true },
    path: 'apps/desktop/src/composer-run-actions.tsx',
    scope: 'combined',
    isBinary: false,
    patch: samplePatch,
    truncated: false,
  };

  const createRequest = () =>
    vi.fn(async (): Promise<HostResponse> => ({
      type: 'response',
      command: 'git/diff-file',
      success: true,
      data: { diff: fileDiff },
    }));

  it('renders proto-01 header with filename, stats, hunk tag, and action buttons', async () => {
    const request = createRequest();
    const onOpenFile = vi.fn();
    const onOpenDiff = vi.fn();

    act(() => {
      root.render(
        <DiffCard
          projectPath="/workspace"
          path="apps/desktop/src/composer-run-actions.tsx"
          request={request}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const card = container.querySelector<HTMLElement>('[data-testid="diff-card"]');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('dc')).toBe(true);

    // Header checks
    const head = card?.querySelector<HTMLElement>('[data-testid="diff-head"]');
    expect(head?.classList.contains('dc-h')).toBe(true);
    expect(head?.querySelector('.file')?.textContent).toBe('composer-run-actions.tsx');
    expect(head?.querySelector('[data-testid="diff-stats"]')?.textContent).toContain('+2');
    expect(head?.querySelector('[data-testid="diff-stats"]')?.textContent).toContain('−1');
    expect(head?.querySelector('.hunk')?.textContent).toBe('@@ -85,7 +85,9 @@');

    // Header actions
    expect(head?.querySelector('[data-testid="diff-open-file"]')?.textContent).toBe('打开');
    expect(head?.querySelector('[data-testid="diff-rollback"]')?.textContent).toBe('回滚');
    expect(head?.querySelector('[data-testid="diff-open-all"]')?.textContent).toContain('全部差异');

    // Clicking 打开 calls onOpenFile
    act(() => {
      head?.querySelector<HTMLElement>('[data-testid="diff-open-file"]')?.click();
    });
    expect(onOpenFile).toHaveBeenCalledWith('apps/desktop/src/composer-run-actions.tsx');

    // Clicking 全部差异 calls onOpenDiff with resolved absolute path
    act(() => {
      head?.querySelector<HTMLElement>('[data-testid="diff-open-all"]')?.click();
    });
    expect(onOpenDiff).toHaveBeenCalledWith(
      '/workspace/apps/desktop/src/composer-run-actions.tsx',
      'apps/desktop/src/composer-run-actions.tsx',
    );
  });

  it('renders diff body with hunk header and added/deleted lines', async () => {
    const request = createRequest();

    act(() => {
      root.render(
        <DiffCard
          projectPath="/workspace"
          path="apps/desktop/src/composer-run-actions.tsx"
          request={request}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const body = container.querySelector<HTMLElement>('.diff-body');
    expect(body).not.toBeNull();
    expect(body?.classList.contains('dc-b')).toBe(true);

    // Hunk row
    const hunkRow = body?.querySelector('.dl.hk');
    expect(hunkRow?.textContent).toContain('@@ -85,7 +85,9 @@');

    // Added and deleted lines
    const addRows = body?.querySelectorAll('.dl.a');
    const delRows = body?.querySelectorAll('.dl.d');
    expect(addRows?.length).toBe(2);
    expect(delRows?.length).toBe(1);
  });

  it('renders footer review actions and updates verdict on Accept / Reject', async () => {
    const request = createRequest();
    const onReview = vi.fn();

    act(() => {
      root.render(
        <DiffCard
          projectPath="/workspace"
          path="apps/desktop/src/composer-run-actions.tsx"
          request={request}
          onReview={onReview}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const footer = container.querySelector<HTMLElement>('[data-testid="diff-footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.textContent).toContain('3 处修改 · 已写入磁盘 · 拒绝 = 回滚此文件');

    const rejectBtn = footer?.querySelector<HTMLButtonElement>('[data-verdict="no"]');
    const acceptBtn = footer?.querySelector<HTMLButtonElement>('[data-verdict="ok"]');
    expect(rejectBtn?.textContent).toBe('拒绝');
    expect(acceptBtn?.textContent).toBe('接受');

    // Click Accept
    act(() => {
      acceptBtn?.click();
    });

    expect(onReview).toHaveBeenCalledWith('apps/desktop/src/composer-run-actions.tsx', true);
    expect(container.querySelector('.vd.ok')?.textContent).toBe('✓ 已接受');
    expect(footer?.textContent).toContain('3 处修改 · 已接受');
  });

  it('clicking rollback in header triggers rejection review and updates verdict', async () => {
    const request = createRequest();
    const onReview = vi.fn();

    act(() => {
      root.render(
        <DiffCard
          projectPath="/workspace"
          path="apps/desktop/src/composer-run-actions.tsx"
          request={request}
          onReview={onReview}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      container.querySelector<HTMLElement>('[data-testid="diff-rollback"]')?.click();
    });

    expect(onReview).toHaveBeenCalledWith('apps/desktop/src/composer-run-actions.tsx', false);
    expect(container.querySelector('.vd.no')?.textContent).toBe('已拒绝 · 已回滚');
  });
});
