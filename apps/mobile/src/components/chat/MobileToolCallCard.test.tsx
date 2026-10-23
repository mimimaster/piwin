// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MobileToolCall } from '../../mobile-transcript.js';
import { MobileToolCallCard } from './MobileToolCallCard.js';
import { MobileToolChain } from './MobileToolChain.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const RUNNING_TOOL: MobileToolCall = { id: 'tool-1', name: 'apple_health_read', status: 'running' };
const HEALTH_TOOL: MobileToolCall = {
  ...RUNNING_TOOL,
  status: 'done',
  presentation: { kind: 'health', title: '读取 Apple Health' },
};

describe('mobile tool cards keep a fixed hook order', () => {
  let container: HTMLElement;
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

  it('switches a streamed tool card to its health presentation', () => {
    act(() => root.render(<MobileToolCallCard tool={RUNNING_TOOL} />));
    expect(() => act(() => root.render(<MobileToolCallCard tool={HEALTH_TOOL} />))).not.toThrow();
    expect(container.textContent).toContain('读取 Apple Health');
  });

  it('renders a chain that drains back to empty', () => {
    act(() => root.render(<MobileToolChain tools={[RUNNING_TOOL, { ...RUNNING_TOOL, id: 'tool-2' }]} />));
    expect(() => act(() => root.render(<MobileToolChain tools={[]} />))).not.toThrow();
    expect(container.querySelector('[data-testid="mobile-tool-chain"]')).toBeNull();
  });
});
