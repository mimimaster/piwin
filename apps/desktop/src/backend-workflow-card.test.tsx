// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { BackendWorkflowSnapshot } from '@piwin/contracts';
import { BackendWorkflowCard } from './backend-workflow-card.js';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeWorkflow(overrides?: Partial<BackendWorkflowSnapshot>): BackendWorkflowSnapshot {
  return {
    workflowId: 'wf-deep-research-1',
    sessionId: 'session-123',
    agentId: 'grok-deep-research',
    name: 'deep-research',
    objective: '调研量子计算在金融高频交易领域的应用可行性',
    status: 'running',
    revision: 1,
    phases: [
      { title: '制定检索规划', status: 'done', detail: '已分析用户意图' },
      { title: '全网多源检索', status: 'active', detail: '已抓取 12 篇学术文献' },
      { title: '深度交叉比对', status: 'pending' },
      { title: '生成综合研报', status: 'pending' },
    ],
    agents: [],
    history: [
      { event: 'query', detail: 'quantum computing HFT arbitrage latency', at: '2026-10-02T03:00:00.000Z' },
    ],
    elapsedMs: 48000,
    reportAvailable: false,
    ...overrides,
  };
}

describe('BackendWorkflowCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders on the tool chain with a spine node, name, and status badge', () => {
    const workflow = makeWorkflow();
    const mockRequest = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <BackendWorkflowCard workflow={workflow} request={mockRequest} locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    const item = container.querySelector('[data-testid="backend-workflow-card"]');
    expect(item).not.toBeNull();
    expect(item?.className).toContain('backend-workflow-chain-item');
    expect(item?.className).toContain('is-running');

    const node = item?.querySelector('.tool-batch-capsule > .node');
    expect(node).not.toBeNull();
    expect(node?.className).toContain('run');
    expect(item?.querySelector('[data-testid="breath-matrix"]')).toBeNull();

    expect(container.textContent).toContain('deep-research');
    expect(container.textContent).toContain('制定检索规划');
    expect(container.textContent).toContain('1/4 · 运行中');
    expect(container.textContent).toContain('48s');
    expect(container.textContent).not.toContain('调研中');
    expect(container.textContent).toContain('全网多源检索');

    // The main page exposes running stages without a click.
    expect(container.querySelector('[data-testid="backend-workflow-details"]')).not.toBeNull();
    expect(item?.querySelector('[data-testid="tool-batch-capsule"]')).not.toBeNull();
  });

  it('expands details drawer on click and shows sub-phases and telemetry', async () => {
    const workflow = makeWorkflow();
    const mockRequest = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <BackendWorkflowCard workflow={workflow} request={mockRequest} locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    const trigger = container.querySelector('[data-testid="tool-batch-header"]') as HTMLButtonElement;
    expect(trigger).not.toBeNull();

    // The caller can collapse and reopen the shared disclosure.
    act(() => trigger.click());
    expect(container.querySelector('[data-testid="backend-workflow-details"]')).toBeNull();
    act(() => {
      trigger.click();
    });

    const details = container.querySelector('[data-testid="backend-workflow-details"]');
    expect(details).not.toBeNull();

    expect(details?.textContent).toContain('制定检索规划');
    expect(details?.textContent).toContain('全网多源检索');
    expect(details?.textContent).toContain('已抓取 12 篇学术文献');
    expect(details?.textContent).toContain('深度交叉比对');
    expect(details?.querySelector('[data-kind="success"]')).not.toBeNull();
    expect(details?.textContent).not.toContain('✓');

    // Telemetry / query logs
    expect(details?.textContent).toContain('执行记录');
    expect(details?.textContent).toContain('quantum computing HFT arbitrage latency');
  });

  it('handles report generation and fetches report on demand', async () => {
    const workflow = makeWorkflow({
      status: 'completed',
      phases: [
        { title: '制定检索规划', status: 'done' },
        { title: '全网多源检索', status: 'done' },
        { title: '深度交叉比对', status: 'done' },
        { title: '生成综合研报', status: 'done' },
      ],
      reportAvailable: true,
    });

    const mockRequest = vi.fn().mockResolvedValue({
      success: true,
      data: { sessionId: 'session-123', workflowId: 'wf-deep-research-1', text: '# 量子计算在HFT中的综合研报\n\n结论：当前阶段存在技术瓶颈。' },
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <BackendWorkflowCard workflow={workflow} request={mockRequest} locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    const item = container.querySelector('[data-testid="backend-workflow-card"]');
    const node = item?.querySelector('.tool-batch-capsule > .node');
    expect(node?.className).toContain('done');
    expect(container.textContent).toContain('已完成');

    // Expand
    const trigger = container.querySelector('[data-testid="tool-batch-header"]') as HTMLButtonElement;
    act(() => {
      trigger.click();
    });

    expect(container.textContent).toContain('查看报告');
    const reportBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('查看报告'));
    expect(reportBtn).toBeDefined();

    // Click to load report
    await act(async () => {
      reportBtn?.click();
    });

    expect(mockRequest).toHaveBeenCalledWith({
      type: 'agents/workflow-report',
      sessionId: 'session-123',
      workflowId: 'wf-deep-research-1',
    });

    expect(container.textContent).toContain('量子计算在HFT中的综合研报');
    expect(container.textContent).toContain('结论：当前阶段存在技术瓶颈。');
  });
  it('recognizes native active status and folds when the workflow finishes', () => {
    const render = (workflow: BackendWorkflowSnapshot) => act(() => root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <BackendWorkflowCard workflow={workflow} request={vi.fn()} locale="zh-CN" />
      </PiwinUiProvider>,
    ));
    render(makeWorkflow({ status: 'active', agents: [{ id: 'planner', label: 'research-planner', phase: '全网多源检索', status: 'running' }] }));
    expect(container.querySelector('[data-testid="tool-batch-header"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('research-planner');
    expect(container.textContent).toContain('运行中');
    expect(container.textContent).not.toContain(' · active');
    render(makeWorkflow({ status: 'completed', reportAvailable: true }));
    expect(container.querySelector('[data-testid="tool-batch-header"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).toContain('已完成');
  });

});
