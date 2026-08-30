import { describe, expect, it } from 'vitest';
import {
  applyContextTelemetry,
  createInitialContextTelemetryState,
} from './context-telemetry-reducer.js';
import { selectContextRingView } from './context-telemetry-selector.js';
import {
  makeContextSnapshot,
  makeKnownOccupancy,
  makeLastRequest,
} from './context-telemetry-test-fixtures.js';
import type { ContextTelemetryState } from './context-telemetry-reducer.js';

function withCapability(state: ContextTelemetryState): ContextTelemetryState {
  return applyContextTelemetry(state, { type: 'capability', supported: true });
}

function selected(
  sessionId: string,
  snapshot: ReturnType<typeof makeContextSnapshot>,
): ContextTelemetryState {
  let state = withCapability(createInitialContextTelemetryState());
  state = applyContextTelemetry(state, {
    type: 'select',
    sessionId,
    hostInstanceId: 'host-1',
  });
  return applyContextTelemetry(state, { type: 'snapshot', snapshot, source: 'live' });
}

describe('context ring selector matrix', () => {
  it('T01: hides empty draft, unsent input, and empty message_start/waiting', () => {
    const draft = withCapability(createInitialContextTelemetryState());
    expect(selectContextRingView({ telemetry: draft, locale: 'en' }).visible).toBe(false);

    const empty = selected(
      'session-a',
      makeContextSnapshot({ sessionId: 'session-a', phase: 'empty' }),
    );
    expect(selectContextRingView({ telemetry: empty, locale: 'en' }).visible).toBe(false);

    const waiting = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'waiting-response',
        occupancy: makeKnownOccupancy({ tokensUsed: 0, tokensLimit: 128_000 }),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: false,
        },
      }),
    );
    expect(selectContextRingView({ telemetry: waiting, locale: 'en' }).visible).toBe(false);
  });

  it('T02: text, thinking, or model tool evidence opens the ring; Host tool noise does not', () => {
    for (const evidenceMessageId of ['text-1', 'think-1', 'tool-1']) {
      const eligible = selected(
        'session-a',
        makeContextSnapshot({
          sessionId: 'session-a',
          phase: 'streaming',
          occupancy: makeKnownOccupancy({
            tokensUsed: 1_200,
            tokensLimit: 128_000,
            quality: 'estimated',
          }),
          responseEvidence: {
            currentRunHasResponse: true,
            historyHasDisplayableResponse: true,
            evidenceMessageId,
          },
        }),
      );
      const view = selectContextRingView({ telemetry: eligible, locale: 'en' });
      expect(view.visible).toBe(true);
      expect(view.quality).toBe('estimated');
    }

    const hostNoise = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'streaming',
        occupancy: makeKnownOccupancy({ tokensUsed: 1_200, tokensLimit: 128_000 }),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: false,
        },
      }),
    );
    expect(selectContextRingView({ telemetry: hostNoise, locale: 'en' }).visible).toBe(false);
  });

  it('T06: eligibility uses Host evidence, not mounted transcript rows', () => {
    const telemetry = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'idle',
        occupancy: makeKnownOccupancy({ tokensUsed: 8_000, tokensLimit: 128_000 }),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
          evidenceMessageId: 'assistant-oldest',
        },
      }),
    );
    const view = selectContextRingView({
      telemetry,
      locale: 'en',
      mountedMessageIds: ['user-latest'],
    });
    expect(view.visible).toBe(true);
    expect(view.tokensUsed).toBe(8_000);
  });

  it('T24: 1M→128K uses the selected window, unknown limit is not 128K, 120% is not clamped in text', () => {
    const againstNewWindow = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'idle',
        occupancy: makeKnownOccupancy({
          tokensUsed: 153_600,
          tokensLimit: 1_000_000,
          quality: 'measured',
        }),
        contextBoundary: {
          activeLeafMessageId: 'a1',
          model: { providerId: 'openai', modelId: 'gpt-1m' },
        },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    const switched = selectContextRingView({
      telemetry: againstNewWindow,
      locale: 'en',
      selectedModelContextWindow: 128_000,
      selectedModel: { providerId: 'openai', modelId: 'gpt-128k' },
    });
    expect(switched.visible).toBe(true);
    expect(switched.tokensLimit).toBe(128_000);
    expect(switched.percentText).toBe(120);
    expect(switched.arcRatio).toBe(1);
    expect(switched.exceedsLimit).toBe(true);
    expect(switched.estimatedAgainstSelectedModel).toBe(true);
    expect(switched.labels.limitNote).toMatch(/selected model window/i);

    const unknownLimit = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'idle',
        occupancy: makeKnownOccupancy({ tokensUsed: 12_400, quality: 'estimated' }),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    const unknown = selectContextRingView({ telemetry: unknownLimit, locale: 'en' });
    expect(unknown.visible).toBe(true);
    expect(unknown.tokensUsed).toBe(12_400);
    expect(unknown.tokensLimit).toBeUndefined();
    expect(unknown.limitUnknown).toBe(true);
    expect(unknown.percentText).toBeUndefined();
    expect(unknown.labels.limitNote).toMatch(/limit unknown/i);
  });

  it('T32: waiting hides, tool-loop keeps, queued does not change current-run eligibility', () => {
    const waitingNextTurn = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'waiting-response',
        occupancy: makeKnownOccupancy({ tokensUsed: 40_000, tokensLimit: 128_000 }),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    expect(selectContextRingView({ telemetry: waitingNextTurn, locale: 'en' }).visible).toBe(
      false,
    );

    const toolLoop = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'streaming',
        occupancy: makeKnownOccupancy({
          tokensUsed: 41_000,
          tokensLimit: 128_000,
          quality: 'estimated',
        }),
        responseEvidence: {
          currentRunHasResponse: true,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    expect(selectContextRingView({ telemetry: toolLoop, locale: 'en' }).visible).toBe(true);

    const queued = selectContextRingView({
      telemetry: toolLoop,
      locale: 'en',
      queuedTurnPending: true,
    });
    expect(queued.visible).toBe(true);
  });

  it('hides numeric ring after compact success with unknown occupancy', () => {
    const compacted = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'idle',
        occupancy: { kind: 'unknown', reason: 'compact-tokens-after-missing' },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    const view = selectContextRingView({
      telemetry: compacted,
      locale: 'en',
      compactPendingOccupancy: true,
    });
    expect(view.visible).toBe(true);
    expect(view.numericHidden).toBe(true);
    expect(view.labels.status).toMatch(/compacted/i);
  });

  it('capability missing hides the ring even with a snapshot', () => {
    let state = createInitialContextTelemetryState();
    state = applyContextTelemetry(state, {
      type: 'select',
      sessionId: 'session-a',
      hostInstanceId: 'host-1',
    });
    state = applyContextTelemetry(state, {
      type: 'snapshot',
      snapshot: makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'idle',
        occupancy: makeKnownOccupancy({ tokensUsed: 10, tokensLimit: 100 }),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
      source: 'live',
    });
    const view = selectContextRingView({ telemetry: state, locale: 'zh-CN' });
    expect(view.visible).toBe(false);
    expect(view.capabilityMissing).toBe(true);
    expect(view.labels.capabilityMissing).toContain('不支持');
  });

  it('offline keeps last same-session value with an offline label', () => {
    let state = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'idle',
        occupancy: makeKnownOccupancy({ tokensUsed: 9_000, tokensLimit: 128_000 }),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    state = applyContextTelemetry(state, { type: 'disconnect' });
    const view = selectContextRingView({ telemetry: state, locale: 'en' });
    expect(view.visible).toBe(true);
    expect(view.offline).toBe(true);
    expect(view.labels.status.toLowerCase()).toMatch(/offline|last/);
  });

  it('does not attach occupancy to last-request rows', () => {
    let state = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'idle',
        occupancy: makeKnownOccupancy({ tokensUsed: 90_000, tokensLimit: 128_000 }),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    state = applyContextTelemetry(state, {
      type: 'last-request',
      sessionId: 'session-a',
      usage: makeLastRequest({
        messageId: 'assistant-7',
        promptTokens: 20,
        completionTokens: 5,
        totalTokens: 25,
      }),
    });
    const view = selectContextRingView({ telemetry: state, locale: 'en' });
    expect(view.tokensUsed).toBe(90_000);
    expect(view.lastRequest?.messageId).toBe('assistant-7');
    expect(view.lastRequest?.totalTokens).toBe(25);
  });
});
