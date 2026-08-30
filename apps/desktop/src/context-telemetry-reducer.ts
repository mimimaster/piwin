import type {
  AssistantUsageMeasurement,
  SessionContextSnapshot,
} from '@piwin/contracts';

/** Same bound as inactive transcript warm: two left sessions. */
export const MAX_CONTEXT_TELEMETRY_WARM = 2;

export type ContextTelemetryWarmEntry = {
  snapshot: SessionContextSnapshot;
  lastRequestUsage: AssistantUsageMeasurement | null;
};

export type ContextTelemetryState = {
  hostInstanceId: string | null;
  selectedSessionId: string | null;
  selectionEpoch: number;
  capabilitySupported: boolean;
  disconnected: boolean;
  displayed: SessionContextSnapshot | null;
  lastRequestUsage: AssistantUsageMeasurement | null;
  warmBySessionId: Record<string, ContextTelemetryWarmEntry>;
  warmOrder: string[];
};

export type ContextTelemetryAction =
  | {
      type: 'select';
      sessionId: string | null;
      hostInstanceId?: string | null;
    }
  | {
      type: 'snapshot';
      snapshot: SessionContextSnapshot;
      source: 'hydrate' | 'live' | 'replay';
      awaitingTranscript?: boolean;
      hostInstanceId?: string | null;
    }
  | {
      type: 'last-request';
      sessionId: string;
      usage: AssistantUsageMeasurement | null;
    }
  | { type: 'capability'; supported: boolean }
  | { type: 'disconnect' }
  | { type: 'reconnect' }
  | { type: 'host-instance'; hostInstanceId: string | null };

export function createInitialContextTelemetryState(): ContextTelemetryState {
  return {
    hostInstanceId: null,
    selectedSessionId: null,
    selectionEpoch: 0,
    capabilitySupported: false,
    disconnected: false,
    displayed: null,
    lastRequestUsage: null,
    warmBySessionId: {},
    warmOrder: [],
  };
}

export function applyContextTelemetry(
  state: ContextTelemetryState,
  action: ContextTelemetryAction,
): ContextTelemetryState {
  switch (action.type) {
    case 'capability':
      return state.capabilitySupported === action.supported
        ? state
        : { ...state, capabilitySupported: action.supported };
    case 'disconnect':
      return state.disconnected ? state : { ...state, disconnected: true };
    case 'reconnect':
      return state.disconnected ? { ...state, disconnected: false } : state;
    case 'host-instance':
      return resetForHostInstance(state, action.hostInstanceId);
    case 'select':
      return selectSession(state, action.sessionId, action.hostInstanceId);
    case 'last-request':
      return applyLastRequest(state, action.sessionId, action.usage);
    case 'snapshot':
      void action.awaitingTranscript;
      return applySnapshot(state, action);
    default:
      return state;
  }
}

function resetForHostInstance(
  state: ContextTelemetryState,
  hostInstanceId: string | null,
): ContextTelemetryState {
  if (state.hostInstanceId === hostInstanceId) {
    return state;
  }
  return {
    ...createInitialContextTelemetryState(),
    hostInstanceId,
    selectedSessionId: state.selectedSessionId,
    selectionEpoch: state.selectionEpoch + 1,
    capabilitySupported: state.capabilitySupported,
  };
}

function selectSession(
  state: ContextTelemetryState,
  sessionId: string | null,
  hostInstanceId: string | null | undefined,
): ContextTelemetryState {
  let next = state;
  if (hostInstanceId !== undefined && hostInstanceId !== state.hostInstanceId) {
    next = resetForHostInstance(state, hostInstanceId);
  }
  const switching = next.selectedSessionId !== sessionId;
  if (!switching && next.selectedSessionId === sessionId) {
    return next;
  }
  let warmBySessionId = next.warmBySessionId;
  let warmOrder = next.warmOrder;
  if (switching && next.selectedSessionId && next.displayed) {
    const stashed = stashWarm(next, next.selectedSessionId, {
      snapshot: next.displayed,
      lastRequestUsage: next.lastRequestUsage,
    });
    warmBySessionId = stashed.warmBySessionId;
    warmOrder = stashed.warmOrder;
  }
  if (sessionId) {
    const { nextById, nextOrder } = takeWarm(warmBySessionId, warmOrder, sessionId);
    const restored = nextById !== warmBySessionId ? warmBySessionId[sessionId] : undefined;
    return {
      ...next,
      selectedSessionId: sessionId,
      selectionEpoch: next.selectionEpoch + 1,
      displayed: restored?.snapshot ?? null,
      lastRequestUsage: restored?.lastRequestUsage ?? null,
      disconnected: false,
      warmBySessionId: restored ? nextById : warmBySessionId,
      warmOrder: restored ? nextOrder : warmOrder,
    };
  }
  return {
    ...next,
    selectedSessionId: null,
    selectionEpoch: next.selectionEpoch + 1,
    displayed: null,
    lastRequestUsage: null,
    disconnected: false,
    warmBySessionId,
    warmOrder,
  };
}

function applyLastRequest(
  state: ContextTelemetryState,
  sessionId: string,
  usage: AssistantUsageMeasurement | null,
): ContextTelemetryState {
  if (state.selectedSessionId !== sessionId) {
    return state;
  }
  if (state.lastRequestUsage === usage) {
    return state;
  }
  return { ...state, lastRequestUsage: usage };
}

function applySnapshot(
  state: ContextTelemetryState,
  action: Extract<ContextTelemetryAction, { type: 'snapshot' }>,
): ContextTelemetryState {
  let next = state;
  if (
    action.hostInstanceId !== undefined &&
    action.hostInstanceId !== state.hostInstanceId
  ) {
    next = resetForHostInstance(state, action.hostInstanceId);
    if (action.hostInstanceId !== undefined) {
      next = { ...next, selectedSessionId: state.selectedSessionId };
    }
  }
  if (next.selectedSessionId !== action.snapshot.sessionId) {
    return next;
  }
  const current = next.displayed;
  if (current && current.sessionId === action.snapshot.sessionId) {
    if (action.snapshot.revision < current.revision) {
      return next;
    }
    if (action.snapshot.revision === current.revision) {
      return next;
    }
  }
  return {
    ...next,
    displayed: action.snapshot,
    disconnected: false,
  };
}

function stashWarm(
  state: ContextTelemetryState,
  sessionId: string,
  entry: ContextTelemetryWarmEntry,
): Pick<ContextTelemetryState, 'warmBySessionId' | 'warmOrder'> {
  const nextById: Record<string, ContextTelemetryWarmEntry> = {
    ...state.warmBySessionId,
    [sessionId]: entry,
  };
  const nextOrder = [...state.warmOrder.filter((id) => id !== sessionId), sessionId];
  while (nextOrder.length > MAX_CONTEXT_TELEMETRY_WARM) {
    const evictId = nextOrder.shift();
    if (evictId) {
      delete nextById[evictId];
    }
  }
  return { warmBySessionId: nextById, warmOrder: nextOrder };
}

function takeWarm(
  byId: Record<string, ContextTelemetryWarmEntry>,
  order: string[],
  sessionId: string,
): {
  nextById: Record<string, ContextTelemetryWarmEntry>;
  nextOrder: string[];
} {
  if (!byId[sessionId]) {
    return { nextById: byId, nextOrder: order };
  }
  const nextById = { ...byId };
  delete nextById[sessionId];
  return {
    nextById,
    nextOrder: order.filter((id) => id !== sessionId),
  };
}
