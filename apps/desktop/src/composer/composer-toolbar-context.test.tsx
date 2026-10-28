// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { SessionUsageTotals } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import {
  applyContextTelemetry,
  createInitialContextTelemetryState,
} from '../context/context-telemetry-reducer.js';
import { selectContextRingView } from '../context/context-telemetry-selector.js';
import {
  makeContextSnapshot,
  makeKnownOccupancy,
} from '../context/context-telemetry-test-fixtures.js';
import { ComposerToolbarContext } from './composer-toolbar-context';
import type { ComposerStatsLineProps } from './composer-stats-line';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

function visibleView(): NonNullable<ComposerStatsLineProps['contextView']> {
  let telemetry = applyContextTelemetry(createInitialContextTelemetryState(), {
    type: 'capability',
    supported: true,
  });
  telemetry = applyContextTelemetry(telemetry, { type: 'select', sessionId: 's1', hostInstanceId: 'host-1' });
  telemetry = applyContextTelemetry(telemetry, {
    type: 'snapshot',
    source: 'live',
    snapshot: makeContextSnapshot({
      sessionId: 's1',
      phase: 'idle',
      contextBoundary: { activeLeafMessageId: 'leaf-1' },
      occupancy: makeKnownOccupancy({ tokensUsed: 32_000, tokensLimit: 128_000, quality: 'measured' }),
      responseEvidence: { currentRunHasResponse: false, historyHasDisplayableResponse: true },
    }),
  });
  return selectContextRingView({ telemetry, locale: 'zh-CN' });
}

const totals: SessionUsageTotals = {
  sessionId: 's1',
  userTurnCount: 3,
  promptTokens: 1000,
  completionTokens: 2300,
  cacheReadTokens: 6000,
  cacheWriteTokens: 1000,
  totalTokens: 12300,
  entryCount: 5,
};

function render(props: Partial<ComposerStatsLineProps>): void {
  act(() =>
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ComposerToolbarContext totals={totals} locale="zh-CN" {...props} />
      </PiwinUiProvider>,
    ),
  );
}

describe('ComposerToolbarContext', () => {
  it('shows the ring and moves the status counters into its popover', () => {
    const view = visibleView();
    expect(view.visible).toBe(true);
    render({ contextView: view });
    const ring = document.querySelector<HTMLButtonElement>('[data-testid="context-usage-ring"]');
    expect(ring).not.toBeNull();
    act(() => ring?.click());
    const stats = document.querySelector('[data-testid="composer-session-stats"]');
    expect(stats?.textContent).toContain('本会话');
    expect(stats?.textContent).toContain('轮数');
    expect(stats?.textContent).toContain('3 轮');
    expect(stats?.textContent).toContain('累计 tokens');
  });

  it('renders nothing while context usage is not known', () => {
    render({});
    expect(document.querySelector('[data-testid="context-usage-ring"]')).toBeNull();
    expect(document.querySelector('[data-testid="composer-session-stats"]')).toBeNull();
  });
});
