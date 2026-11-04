// @vitest-environment happy-dom
/**
 * Summary body: verified data only — unknown context is absent (never 0%), the
 * changes card names its working-tree scope, and empty sections say so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  SessionSummaryPanel,
  type SessionSummaryPanelProps,
} from './session-summary-panel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement | undefined;

function render(overrides: Partial<SessionSummaryPanelProps> = {}): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const node: ReactElement = (
    <SessionSummaryPanel
      locale="zh-CN"
      sessionTitle="排查登录跳转"
      runLabel={null}
      workspaceLabel="项目"
      workspaceDetail="piwin · 未信任"
      context={{ value: '35%', caption: '44.8k / 128k', onOpen: () => {} }}
      changes={{
        value: '+48 −12',
        caption: '整个工作树，含非本会话改动',
        onOpen: () => {},
      }}
      outputs={[]}
      activity={[]}
      tools={[
        { id: 'browser', title: '浏览器', subtitle: 'Host 共享的 Chromium' },
        { id: 'files', title: '文件', subtitle: 'piwin' },
      ]}
      onOpenTool={() => {}}
      {...overrides}
    />
  );
  act(() => {
    root?.render(node);
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('SessionSummaryPanel', () => {
  it('names the session and its workspace scope', () => {
    const el = render();
    expect(el.querySelector('[data-testid="session-summary-session"]')?.textContent).toContain(
      '排查登录跳转',
    );
    expect(
      el.querySelector('[data-testid="session-summary-workspace"]')?.textContent,
    ).toContain('未信任');
  });

  it('keeps the working-tree scope visible instead of claiming session-only changes', () => {
    const el = render();
    const card = el.querySelector('[data-testid="session-summary-changes-card"]');
    expect(card?.textContent).toContain('+48 −12');
    expect(card?.textContent).toContain('整个工作树');
  });

  it('omits the context card when occupancy is unknown rather than showing 0%', () => {
    const el = render({ context: null });
    expect(el.querySelector('[data-testid="session-summary-context-card"]')).toBeNull();
  });

  it('says a section is empty instead of inventing outputs', () => {
    const el = render();
    expect(
      el.querySelector('[data-testid="session-summary-outputs-empty"]'),
    ).not.toBeNull();
    expect(
      el.querySelector('[data-testid="session-summary-activity-empty"]'),
    ).not.toBeNull();
  });

  it('opens the tool a row names', () => {
    const onOpenTool = vi.fn();
    const el = render({ onOpenTool });
    act(() => {
      el.querySelector<HTMLButtonElement>('[data-testid="session-summary-tool-browser"]')?.click();
    });
    expect(onOpenTool).toHaveBeenCalledWith('browser');
  });

  it('lists Host-projected sources and says so when there are none', () => {
    const empty = render();
    expect(
      empty.querySelector('[data-testid="session-summary-sources-empty"]'),
    ).not.toBeNull();

    act(() => root?.unmount());
    const withSources = render({
      sources: [
        {
          id: 'att:u1:img-1',
          title: 'shot.png',
          subtitle: '附件 · media:img-1',
        },
      ],
    });
    const row = withSources.querySelector(
      '[data-testid="session-summary-source-att:u1:img-1"]',
    );
    expect(row?.textContent).toContain('shot.png');
    expect(row?.textContent).toContain('附件');

    act(() => root?.unmount());
    const onOpen = vi.fn();
    const clickable = render({
      sources: [
        {
          id: 'ctx:u1:0',
          title: 'auth.ts',
          subtitle: '引用文件 · src/auth.ts',
          onOpen,
        },
      ],
    });
    act(() => {
      clickable
        .querySelector<HTMLButtonElement>('[data-testid="session-summary-source-ctx:u1:0"]')
        ?.click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('lists real documents and says so when there are none', () => {
    const onOpen = vi.fn();
    const withDocs = render({
      documents: [
        { id: 'doc-1', title: '迁移说明', subtitle: 'docs/migration.md', onOpen },
      ],
    });
    const row = withDocs.querySelector('[data-testid="session-summary-document-doc-1"]');
    expect(row?.textContent).toContain('迁移说明');
    expect(row?.textContent).toContain('docs/migration.md');
    act(() => {
      withDocs
        .querySelector<HTMLButtonElement>('[data-testid="session-summary-document-doc-1"]')
        ?.click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);

    act(() => root?.unmount());
    const empty = render({ documents: [] });
    expect(
      empty.querySelector('[data-testid="session-summary-documents-empty"]'),
    ).not.toBeNull();
  });

  it('prints environment facts it was given and nothing it was not', () => {
    const el = render({
      environment: [
        { id: 'model', label: '模型', value: 'claude-sonnet-4-5' },
        { id: 'thinking', label: '思考强度', value: 'medium' },
      ],
    });
    const rows = [...el.querySelectorAll('.session-summary-fact')].map((node) =>
      node.textContent ?? '',
    );
    expect(rows).toEqual(['模型claude-sonnet-4-5', '思考强度medium']);
    expect(el.querySelector('[data-testid="session-summary-fact-host"]')).toBeNull();
  });

  it('renders a plan with its real step progress', () => {
    const onOpen = vi.fn();
    const el = render({
      outputs: [
        {
          id: 'plan',
          title: '登录流程改造',
          subtitle: '计划 · 2/5 步',
          statusLabel: '进行中',
          statusTone: 'running',
          onOpen,
        },
      ],
    });
    const row = el.querySelector('[data-testid="session-summary-output-plan"]');
    expect(row?.textContent).toContain('2/5');
    act(() => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="session-summary-output-plan"]',
      )?.click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps an informational row non-clickable', () => {
    const el = render({
      outputs: [
        {
          id: 'walkthroughs',
          title: '交付报告',
          subtitle: '2 条已生成',
          statusLabel: '2',
          statusTone: 'neutral',
        },
      ],
    });
    const row = el.querySelector('[data-testid="session-summary-output-walkthroughs"]');
    expect(row).not.toBeNull();
    expect(
      el.querySelector('[data-testid="session-summary-output-walkthroughs"]')?.tagName,
    ).toBe('DIV');
  });
});
