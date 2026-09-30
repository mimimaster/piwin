// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DraftAgentPicker } from './draft-agent-picker';
import { DesktopLocaleProvider } from './desktop-locale-context';
import type { ComposerDraftAgentOption } from './composer-dock-types';

const BOTH_READY: ComposerDraftAgentOption[] = [
  { agentId: 'pi', label: 'Pi', ready: true },
  { agentId: 'grok', label: 'Grok Build', ready: true },
];

const GROK_NOT_READY: ComposerDraftAgentOption[] = [
  { agentId: 'pi', label: 'Pi', ready: true },
  { agentId: 'grok', label: 'Grok Build', ready: false },
];

describe('DraftAgentPicker', () => {
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
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  function render(node: React.ReactElement): void {
    act(() => {
      root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
    });
  }

  function radio(value: string): HTMLInputElement | undefined {
    return Array.from(container.querySelectorAll('input[type="radio"]')).find(
      (input) => (input as HTMLInputElement).value === value,
    ) as HTMLInputElement | undefined;
  }

  it('renders every known agent', () => {
    render(<DraftAgentPicker value="pi" options={BOTH_READY} onChange={vi.fn()} />);
    expect(container.textContent).toContain('Pi');
    expect(container.textContent).toContain('Grok Build');
  });

  it('reports a switch to a ready agent', () => {
    const onChange = vi.fn();
    render(<DraftAgentPicker value="pi" options={BOTH_READY} onChange={onChange} />);

    act(() => {
      radio('grok')?.click();
    });

    expect(onChange).toHaveBeenCalledWith('grok');
  });

  it('keeps a not-ready agent visible but unselectable', () => {
    const onChange = vi.fn();
    render(<DraftAgentPicker value="pi" options={GROK_NOT_READY} onChange={onChange} />);

    // Visible so the user knows it exists…
    expect(container.textContent).toContain('Grok Build');
    // …but marked as needing setup (default locale is zh-CN) and not switchable.
    expect(container.textContent).toContain('完成配置');
    const grok = radio('grok');
    expect(grok?.disabled).toBe(true);
    act(() => {
      grok?.click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('localizes the not-ready affordance', () => {
    render(
      <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
        <DraftAgentPicker value="pi" options={GROK_NOT_READY} onChange={vi.fn()} />
      </DesktopLocaleProvider>,
    );
    expect(container.textContent).toContain('Setup');
  });

  it('disables the whole control while a run is streaming', () => {
    render(<DraftAgentPicker value="pi" options={BOTH_READY} onChange={vi.fn()} disabled />);
    expect(radio('pi')?.disabled).toBe(true);
  });
});
