// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionBackendOptions } from '@piwin/contracts';
import type { ComposerDockProps } from './composer-dock-types';
import { useTranscriptComposerCard } from './transcript-composer-card.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function baseCard(overrides: Partial<ComposerDockProps> = {}): ComposerDockProps {
  // Only the fields the hook inspects matter here; the rest is opaque data.
  return {
    composer: '',
    modelOptions: [],
    selectedModelKey: 'acme/one',
    onSelectModel: vi.fn(),
    onAbort: vi.fn(),
    onAgentModeChange: vi.fn(),
    ...overrides,
  } as unknown as ComposerDockProps;
}

describe('useTranscriptComposerCard', () => {
  let container: HTMLDivElement;
  let root: Root;
  const seen: ComposerDockProps[] = [];

  function Probe(props: { card: ComposerDockProps }): ReactElement | null {
    seen.push(useTranscriptComposerCard(props.card));
    return null;
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    seen.length = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps identity while the draft text and handler closures change', () => {
    const modelOptions: ComposerDockProps['modelOptions'] = [];
    const firstAbort = vi.fn();
    const secondAbort = vi.fn();
    act(() =>
      root.render(<Probe card={baseCard({ composer: 'h', modelOptions, onAbort: firstAbort })} />),
    );
    act(() =>
      root.render(
        <Probe card={baseCard({ composer: 'he', modelOptions, onAbort: secondAbort })} />,
      ),
    );

    expect(seen[1]).toBe(seen[0]);
    seen[1]?.onAbort();
    expect(firstAbort).not.toHaveBeenCalled();
    expect(secondAbort).toHaveBeenCalledTimes(1);
  });

  it('updates when a transcript-read data field changes', () => {
    const modelOptions: ComposerDockProps['modelOptions'] = [];
    act(() => root.render(<Probe card={baseCard({ modelOptions })} />));
    act(() =>
      root.render(<Probe card={baseCard({ modelOptions, selectedModelKey: 'acme/two' })} />),
    );

    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[1]?.selectedModelKey).toBe('acme/two');
  });

  it('replaces the loading snapshot when the backend catalog arrives', () => {
    const modelOptions: ComposerDockProps['modelOptions'] = [];
    const loaded: SessionBackendOptions = {
      agentId: 'grok',
      models: [{ id: 'grok-fast', label: 'Grok Fast', efforts: ['low', 'high'] }],
      currentModelId: 'grok-fast',
      currentEffortId: 'high',
      modes: [],
      modeConfirmed: false,
      commands: [],
    };
    act(() => root.render(<Probe card={baseCard({
      modelOptions, activeSessionId: 'grok-1', activeAgentId: 'grok', backendOptions: null,
    })} />));
    act(() => root.render(<Probe card={baseCard({
      modelOptions, activeSessionId: 'grok-1', activeAgentId: 'grok', backendOptions: loaded,
    })} />));

    expect(seen[1]?.backendOptions).toBe(loaded);
    expect(seen[1]).not.toBe(seen[0]);
  });

  it.each([
    { firstAgent: 'grok', nextAgent: 'pi' },
    { firstAgent: 'pi', nextAgent: 'grok' },
  ])('tracks a session change from $firstAgent to $nextAgent without a Pi model change', ({ firstAgent, nextAgent }) => {
    const modelOptions: ComposerDockProps['modelOptions'] = [];
    act(() => root.render(<Probe card={baseCard({
      modelOptions, activeSessionId: 'first-session', activeAgentId: firstAgent,
    })} />));
    act(() => root.render(<Probe card={baseCard({
      modelOptions, activeSessionId: 'next-session', activeAgentId: nextAgent,
    })} />));

    expect(seen[1]?.activeSessionId).toBe('next-session');
    expect(seen[1]?.activeAgentId).toBe(nextAgent);
    expect(seen[1]).not.toBe(seen[0]);
  });

  it('tracks draft engine changes without changing the Pi model selection', () => {
    const modelOptions: ComposerDockProps['modelOptions'] = [];
    act(() => root.render(<Probe card={baseCard({
      modelOptions, activeSessionId: null, draftAgentId: 'pi',
    })} />));
    act(() => root.render(<Probe card={baseCard({
      modelOptions, activeSessionId: null, draftAgentId: 'grok',
    })} />));

    expect(seen[1]?.draftAgentId).toBe('grok');
  });

  it('keeps backend and engine handlers late-bound while the snapshot is stable', () => {
    const modelOptions: ComposerDockProps['modelOptions'] = [];
    const earlier = {
      onBackendModelChange: vi.fn(), onBackendEffortChange: vi.fn(), onBackendModeChange: vi.fn(),
      onDraftAgentChange: vi.fn(), onStartNewSession: vi.fn(),
    };
    const current = {
      onBackendModelChange: vi.fn(), onBackendEffortChange: vi.fn(), onBackendModeChange: vi.fn(),
      onDraftAgentChange: vi.fn(), onStartNewSession: vi.fn(),
    };
    act(() => root.render(<Probe card={baseCard({ modelOptions, ...earlier })} />));
    act(() => root.render(<Probe card={baseCard({ modelOptions, ...current })} />));

    expect(seen[1]).toBe(seen[0]);
    seen[1]?.onBackendModelChange?.('fast');
    seen[1]?.onBackendEffortChange?.('high');
    seen[1]?.onBackendModeChange?.('plan');
    seen[1]?.onDraftAgentChange?.('pi');
    void seen[1]?.onStartNewSession?.({ agentId: 'pi' });
    for (const handler of Object.values(earlier)) expect(handler).not.toHaveBeenCalled();
    expect(current.onBackendModelChange).toHaveBeenCalledWith('fast');
    expect(current.onBackendEffortChange).toHaveBeenCalledWith('high');
    expect(current.onBackendModeChange).toHaveBeenCalledWith('plan');
    expect(current.onDraftAgentChange).toHaveBeenCalledWith('pi');
    expect(current.onStartNewSession).toHaveBeenCalledWith({ agentId: 'pi' });
  });

  it('exposes an optional handler only while the source provides one', () => {
    const modelOptions: ComposerDockProps['modelOptions'] = [];
    act(() => root.render(<Probe card={baseCard({ modelOptions })} />));
    expect(seen[0]?.onOrchestrationSchemeChange).toBeUndefined();
    const onOrchestrationSchemeChange = vi.fn();
    act(() =>
      root.render(<Probe card={baseCard({ modelOptions, onOrchestrationSchemeChange })} />),
    );
    expect(seen[1]).not.toBe(seen[0]);
    seen[1]?.onOrchestrationSchemeChange?.('plan');
    expect(onOrchestrationSchemeChange).toHaveBeenCalledWith('plan');
  });
});
