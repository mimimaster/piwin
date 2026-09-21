import { describe, expect, it } from 'vitest';
import {
  applyContextTelemetry,
  createInitialContextTelemetryState,
} from './context-telemetry-reducer.js';
import {
  isChatCompactPendingOccupancy,
  selectContextRingView,
} from './context-telemetry-selector.js';
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

const STALE_EN = 'Last confirmed; current context pending measurement';
const STALE_ZH = '上次确认，当前上下文待测量';
const SHARED_BOUNDARY = {
  model: { providerId: 'openai', modelId: 'gpt-1' },
  compactionBoundary: 'compact:a',
  capabilityFingerprint: 'cap-a',
  seedFingerprint: 'seed-a',
} as const;

function runtimeMismatchSnapshot(overrides: Parameters<typeof makeContextSnapshot>[0] = {}) {
  return makeContextSnapshot({
    sessionId: 'session-a',
    phase: 'invalidated',
    contextBoundary: { activeLeafMessageId: 'voice-live-leaf', ...SHARED_BOUNDARY },
    occupancy: { kind: 'unknown', reason: 'runtime-generation-mismatch' },
    lastConfirmed: {
      occupancy: makeKnownOccupancy({ tokensUsed: 7_797, tokensLimit: 500_000 }),
      contextBoundary: { activeLeafMessageId: 'piw-old-leaf', ...SHARED_BOUNDARY },
      sampledAt: '2026-09-01T08:23:05.531Z',
    },
    responseEvidence: {
      currentRunHasResponse: false,
      historyHasDisplayableResponse: true,
    },
    ...overrides,
  });
}

function runtimeMismatchTelemetry(overrides: Parameters<typeof makeContextSnapshot>[0] = {}) {
  return selected('session-a', runtimeMismatchSnapshot(overrides));
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
      expect(view.cacheAnchorAt).toBe('2026-08-30T00:00:00.000Z');
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

  it('T32: follow-up waiting keeps occupancy, tool-loop keeps, queued does not change current-run eligibility', () => {
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
    const waitingView = selectContextRingView({ telemetry: waitingNextTurn, locale: 'en' });
    expect(waitingView.visible).toBe(true);
    expect(waitingView.tokensUsed).toBe(40_000);
    expect(waitingView.occupancySource).toBe('current');

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

  it('shows a neutral pending ring for derived sessions with copied history evidence', () => {
    const derived = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'idle',
        contextBoundary: { activeLeafMessageId: 'derived-leaf' },
        occupancy: { kind: 'unknown', reason: 'derived-session' },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    const view = selectContextRingView({
      telemetry: derived,
      locale: 'en',
      selectedModelContextWindow: 128_000,
    });
    expect(view.visible).toBe(true);
    expect(view.numericHidden).toBe(true);
    expect(view.tokensUsed).toBeUndefined();
    expect(view.tokensLimit).toBe(128_000);
    expect(view.occupancySource).toBe('current');
    expect(view.labels.status).toBe('Current context pending measurement');
    expect(view.labels.hover).toBe('Current context pending measurement');
    expect(view.labels.accessibleLabel).toBe('Current context pending measurement');
    expect(view.percentText).toBeUndefined();
  });

  it('shows lastConfirmed on idle dirty occupancy and holds it while the next run waits', () => {
    const lastConfirmed = {
      occupancy: makeKnownOccupancy({ tokensUsed: 23_065, tokensLimit: 128_000 }),
      contextBoundary: { activeLeafMessageId: 'leaf-1' },
      sampledAt: '2026-08-30T00:00:00.000Z',
    };
    const dirtyIdle = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'idle',
        contextBoundary: { activeLeafMessageId: 'leaf-1' },
        occupancy: { kind: 'unknown', reason: 'waiting-for-response' },
        lastConfirmed,
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    const visible = selectContextRingView({ telemetry: dirtyIdle, locale: 'en' });
    expect(visible.visible).toBe(true);
    expect(visible.tokensUsed).toBe(23_065);
    expect(visible.occupancySource).toBe('current');
    expect(visible.labels.status).toBe('Confirmed');
    expect(visible.labels.quality).toBe('Confirmed');
    expect(visible.labels.status).not.toBe(STALE_EN);

    const waitingDirty = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'waiting-response',
        contextBoundary: { activeLeafMessageId: 'leaf-1' },
        occupancy: { kind: 'unknown', reason: 'waiting-for-response' },
        lastConfirmed,
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    const waitingView = selectContextRingView({ telemetry: waitingDirty, locale: 'en' });
    expect(waitingView.visible).toBe(true);
    expect(waitingView.tokensUsed).toBe(23_065);
    expect(waitingView.occupancySource).toBe('current');
    expect(waitingView.labels.status).toBe('Confirmed');
    expect(waitingView.labels.status).not.toBe(STALE_EN);
  });

  it('shows stale lastConfirmed for runtime-generation-mismatch with a moved leaf', () => {
    const telemetry = runtimeMismatchTelemetry();
    const view = selectContextRingView({ telemetry, locale: 'en' });
    expect(view.visible).toBe(true);
    expect(view.tokensUsed).toBe(7_797);
    expect(view.occupancySource).toBe('last-confirmed');
    expect(view.cacheAnchorAt).toBe('2026-09-01T08:23:05.531Z');
    expect(view.phase).toBe('invalidated');
    expect(view.labels.status).toBe(STALE_EN);
    expect(view.labels.quality).toBe(STALE_EN);
    expect(view.labels.status).not.toBe('Confirmed');
    expect(view.labels.quality).not.toBe('Confirmed');

    const zh = selectContextRingView({ telemetry, locale: 'zh-CN' });
    expect(zh.labels.status).toBe(STALE_ZH);
    expect(zh.labels.quality).toBe(STALE_ZH);
    expect(zh.labels.status).not.toBe('已确认');
    expect(zh.labels.quality).not.toBe('已确认');
  });

  it('does not mutate the reducer snapshot when presenting stale lastConfirmed', () => {
    const telemetry = runtimeMismatchTelemetry();
    const displayed = telemetry.displayed;
    expect(displayed?.phase).toBe('invalidated');
    expect(displayed?.occupancy).toEqual({
      kind: 'unknown',
      reason: 'runtime-generation-mismatch',
    });
    const view = selectContextRingView({ telemetry, locale: 'en' });
    expect(view.visible).toBe(true);
    expect(view.occupancySource).toBe('last-confirmed');
    expect(telemetry.displayed).toBe(displayed);
    expect(telemetry.displayed?.phase).toBe('invalidated');
    expect(telemetry.displayed?.occupancy).toEqual({
      kind: 'unknown',
      reason: 'runtime-generation-mismatch',
    });
  });

  it('presents the legacy idle mismatch shape as stale until Host cold repair runs', () => {
    const telemetry = runtimeMismatchTelemetry({ phase: 'idle' });
    const view = selectContextRingView({ telemetry, locale: 'en' });
    expect(view.visible).toBe(true);
    expect(view.occupancySource).toBe('last-confirmed');
    expect(view.tokensUsed).toBe(7_797);
    expect(view.labels.status).toBe(STALE_EN);
    expect(telemetry.displayed?.occupancy.kind).toBe('unknown');
  });

  it('presents an interrupted idle waiting shape as stale until Host cold repair runs', () => {
    const telemetry = runtimeMismatchTelemetry({
      phase: 'idle',
      occupancy: { kind: 'unknown', reason: 'waiting-for-response' },
    });
    const view = selectContextRingView({ telemetry, locale: 'en' });
    expect(view.visible).toBe(true);
    expect(view.occupancySource).toBe('last-confirmed');
    expect(view.tokensUsed).toBe(7_797);
    expect(view.labels.status).toBe(STALE_EN);
    expect(telemetry.displayed?.occupancy).toEqual({
      kind: 'unknown',
      reason: 'waiting-for-response',
    });
  });

  it('does not present the legacy idle mismatch ring during an active run', () => {
    for (const overrides of [
      { phase: 'idle' as const, runId: 'run-live' },
      {
        phase: 'idle' as const,
        responseEvidence: {
          currentRunHasResponse: true,
          historyHasDisplayableResponse: true,
          evidenceMessageId: 'assistant-live',
        },
      },
    ]) {
      const view = selectContextRingView({
        telemetry: runtimeMismatchTelemetry(overrides),
        locale: 'en',
      });
      expect(view.visible).toBe(false);
      expect(view.tokensUsed).toBeUndefined();
      expect(view.occupancySource).toBe('current');
    }
  });

  it('does not treat an invalidated waiting row as a stale confirmation', () => {
    const view = selectContextRingView({
      telemetry: runtimeMismatchTelemetry({
        phase: 'invalidated',
        occupancy: { kind: 'unknown', reason: 'waiting-for-response' },
      }),
      locale: 'en',
    });
    expect(view.visible).toBe(false);
    expect(view.tokensUsed).toBeUndefined();
  });

  it('hides lastConfirmed for abort, compaction-unmeasured, store, and branch/schema reasons', () => {
    const blocked = [
      { phase: 'idle' as const, reason: 'error-or-aborted-usage' },
      { phase: 'idle' as const, reason: 'compaction-unmeasured' },
      { phase: 'unavailable' as const, reason: 'store-unavailable' },
      { phase: 'invalidated' as const, reason: 'branch-switch' },
      { phase: 'invalidated' as const, reason: 'schema-or-session-mismatch' },
    ];
    for (const row of blocked) {
      const view = selectContextRingView({
        telemetry: runtimeMismatchTelemetry({
          phase: row.phase,
          occupancy: { kind: 'unknown', reason: row.reason },
        }),
        locale: 'en',
      });
      expect({
        reason: row.reason,
        visible: view.visible,
        tokensUsed: view.tokensUsed,
        occupancySource: view.occupancySource,
        status: view.labels.status,
        quality: view.labels.quality,
      }).toEqual({
        reason: row.reason,
        visible: false,
        tokensUsed: undefined,
        occupancySource: 'current',
        status: '',
        quality: '',
      });
    }
  });

  it('keeps a model-mismatch sample as stale presentation, but hides other boundary mismatches', () => {
    const modelMismatch = runtimeMismatchTelemetry({
      lastConfirmed: {
        occupancy: makeKnownOccupancy({ tokensUsed: 7_797, tokensLimit: 500_000 }),
        contextBoundary: {
          activeLeafMessageId: 'piw-old-leaf',
          ...SHARED_BOUNDARY,
          model: { providerId: 'anthropic', modelId: 'claude-3' },
        },
        sampledAt: '2026-09-01T08:23:05.531Z',
      },
    });
    const staleModelView = selectContextRingView({ telemetry: modelMismatch, locale: 'en' });
    expect(staleModelView.visible).toBe(true);
    expect(staleModelView.occupancySource).toBe('last-confirmed');
    expect(staleModelView.tokensUsed).toBe(7_797);
    expect(staleModelView.labels.status).toBe(STALE_EN);

    const incompatible = [
      {
        lastConfirmed: {
          occupancy: makeKnownOccupancy({ tokensUsed: 7_797, tokensLimit: 500_000 }),
          contextBoundary: {
            activeLeafMessageId: 'piw-old-leaf',
            ...SHARED_BOUNDARY,
            compactionBoundary: 'compact:after',
          },
          sampledAt: '2026-09-01T08:23:05.531Z',
        },
      },
      {
        lastConfirmed: {
          occupancy: makeKnownOccupancy({ tokensUsed: 7_797, tokensLimit: 500_000 }),
          contextBoundary: {
            activeLeafMessageId: 'piw-old-leaf',
            ...SHARED_BOUNDARY,
            capabilityFingerprint: 'cap-b',
          },
          sampledAt: '2026-09-01T08:23:05.531Z',
        },
      },
      {
        lastConfirmed: {
          occupancy: makeKnownOccupancy({ tokensUsed: 7_797, tokensLimit: 500_000 }),
          contextBoundary: {
            activeLeafMessageId: 'piw-old-leaf',
            ...SHARED_BOUNDARY,
            seedFingerprint: 'seed-b',
          },
          sampledAt: '2026-09-01T08:23:05.531Z',
        },
      },
    ];
    for (const overrides of incompatible) {
      const view = selectContextRingView({
        telemetry: runtimeMismatchTelemetry(overrides),
        locale: 'en',
      });
      expect(view.visible).toBe(false);
      expect(view.tokensUsed).toBeUndefined();
      expect(view.occupancySource).toBe('current');
    }
  });

  it('holds runtime-generation-mismatch lastConfirmed while waiting without a current response', () => {
    const view = selectContextRingView({
      telemetry: runtimeMismatchTelemetry({
        phase: 'waiting-response',
        runId: 'run-2',
      }),
      locale: 'en',
    });
    expect(view.visible).toBe(true);
    expect(view.tokensUsed).toBe(7_797);
    expect(view.occupancySource).toBe('current');
    expect(view.labels.status).toBe('Confirmed');
    expect(view.labels.status).not.toBe(STALE_EN);
  });

  it('hides numeric ring after compact success with unknown occupancy', () => {
    const compacted = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'idle',
        occupancy: { kind: 'unknown', reason: 'unavailable' },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    expect(
      isChatCompactPendingOccupancy({
        lastCompactionMessage: null,
        contextTelemetry: compacted,
      }),
    ).toBe(false);
    const compactPendingOccupancy = isChatCompactPendingOccupancy({
      lastCompactionMessage: 'Context compacted',
      contextTelemetry: compacted,
    });
    expect(compactPendingOccupancy).toBe(true);
    const view = selectContextRingView({
      telemetry: compacted,
      locale: 'en',
      compactPendingOccupancy,
    });
    expect(view.visible).toBe(true);
    expect(view.numericHidden).toBe(true);
    expect(view.labels.status).toMatch(/compacted/i);
    expect(view.phase).toBe('compacted-pending');
  });

  it('keeps a compact-pending ring after reload from the durable boundary', () => {
    const compacted = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'idle',
        contextBoundary: {
          activeLeafMessageId: 'leaf-1',
          compactionBoundary: 'compact:80000:unknown',
        },
        occupancy: { kind: 'unknown', reason: 'compaction-unmeasured' },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    const compactPendingOccupancy = isChatCompactPendingOccupancy({
      lastCompactionMessage: null,
      contextTelemetry: compacted,
    });
    expect(compactPendingOccupancy).toBe(true);
    const view = selectContextRingView({
      telemetry: compacted,
      locale: 'en',
      compactPendingOccupancy,
    });
    expect(view.visible).toBe(true);
    expect(view.numericHidden).toBe(true);
    expect(view.phase).toBe('compacted-pending');
  });

  it('keeps a compact-pending ring when model rebind invalidates the first sample', () => {
    const compacted = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'invalidated',
        contextBoundary: {
          activeLeafMessageId: 'leaf-1',
          compactionBoundary: 'compact:80000:unknown',
          model: { providerId: 'openai', modelId: 'gpt-5' },
        },
        occupancy: { kind: 'unknown', reason: 'runtime-generation-mismatch' },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    const compactPendingOccupancy = isChatCompactPendingOccupancy({
      lastCompactionMessage: null,
      contextTelemetry: compacted,
    });
    expect(compactPendingOccupancy).toBe(true);
    const view = selectContextRingView({
      telemetry: compacted,
      locale: 'en',
      compactPendingOccupancy,
    });
    expect(view.visible).toBe(true);
    expect(view.numericHidden).toBe(true);
    expect(view.phase).toBe('compacted-pending');
  });

  it('keeps numbers and the compacting label while compacting a known sample', () => {
    const known = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'idle',
        occupancy: makeKnownOccupancy({ tokensUsed: 80_000, tokensLimit: 128_000 }),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    expect(
      isChatCompactPendingOccupancy({
        lastCompactionMessage: null,
        contextTelemetry: known,
      }),
    ).toBe(false);
    const view = selectContextRingView({
      telemetry: known,
      locale: 'en',
      compacting: true,
      compactPendingOccupancy: isChatCompactPendingOccupancy({
        lastCompactionMessage: null,
        contextTelemetry: known,
      }),
    });
    expect(view.visible).toBe(true);
    expect(view.numericHidden).toBe(false);
    expect(view.tokensUsed).toBe(80_000);
    expect(view.compacting).toBe(true);
    expect(view.phase).toBe('compacting');
    expect(view.labels.status).toMatch(/compacting/i);
    expect(view.labels.status).not.toMatch(/compacted/i);
  });

  it('hides occupancy when Host marks the context version invalidated', () => {
    const invalidated = selected(
      'session-a',
      makeContextSnapshot({
        sessionId: 'session-a',
        phase: 'invalidated',
        occupancy: makeKnownOccupancy({ tokensUsed: 80_000, tokensLimit: 128_000 }),
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
      }),
    );
    expect(selectContextRingView({ telemetry: invalidated, locale: 'en' }).visible).toBe(false);
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
