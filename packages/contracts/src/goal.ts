/**
 * Goal mode display contract.
 *
 * The bundled goal extension (`@narumitw/pi-goal`) returns structured `details`
 * from `goal_complete` / `goal_blocked` / `goal_wait`. Desktop must never read
 * Pi-native tool details, so the Host lifts them onto
 * `ToolPresentation.goal` — the same route `flashcard` and `health` take.
 */

/** Tool names owned by the bundled goal extension. */
export const GOAL_TOOL_NAMES = ['goal_complete', 'goal_blocked', 'goal_wait'] as const;

export type GoalToolName = (typeof GOAL_TOOL_NAMES)[number];

const GOAL_TOOL_NAME_SET: ReadonlySet<string> = new Set(GOAL_TOOL_NAMES);

export function isGoalToolName(value: unknown): value is GoalToolName {
  return typeof value === 'string' && GOAL_TOOL_NAME_SET.has(value);
}

/**
 * A single goal signal. `phase` mirrors the extension's `details.status`, so a
 * reader never has to know which tool produced it.
 *
 * `waited` is emitted when the wait *finishes*; a wait still in flight is a
 * running `goal_wait` tool call, which the UI derives from tool status rather
 * than from this payload.
 */
export type GoalDisplayPayload =
  | {
      phase: 'completed';
      summary: string;
      /** Evidence the model offered: test/lint/build output. */
      verification?: string;
      /** Paths the model created, changed, or wants the user to read. */
      artifacts?: string[];
    }
  | {
      phase: 'blocked';
      reason: string;
      /** What the model needs from the user to make progress. */
      unblockAction?: string;
    }
  | {
      phase: 'waited';
      reason: string;
      durationSeconds?: number;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const paths = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return paths.length > 0 ? paths : undefined;
}

function readSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/**
 * Parse a goal tool's `details` into a display payload.
 *
 * Returns null for anything that is not a recognised goal signal, so a
 * non-goal tool that happens to carry a `status` field can never grow a goal
 * card. Accepts a JSON string for parity with `parseFlashcardDisplayPayload`.
 */
export function parseGoalDisplayPayload(value: unknown): GoalDisplayPayload | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      return parseGoalDisplayPayload(JSON.parse(trimmed) as unknown);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;

  switch (value.status) {
    case 'completed': {
      const summary = readText(value.summary);
      if (!summary) return null;
      const verification = readText(value.verification);
      const artifacts = readPaths(value.artifacts);
      return {
        phase: 'completed',
        summary,
        ...(verification !== undefined ? { verification } : {}),
        ...(artifacts !== undefined ? { artifacts } : {}),
      };
    }
    case 'blocked': {
      const reason = readText(value.reason);
      if (!reason) return null;
      const unblockAction = readText(value.unblockAction);
      return {
        phase: 'blocked',
        reason,
        ...(unblockAction !== undefined ? { unblockAction } : {}),
      };
    }
    case 'waited': {
      const reason = readText(value.reason);
      if (!reason) return null;
      const durationSeconds = readSeconds(value.durationSeconds);
      return {
        phase: 'waited',
        reason,
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      };
    }
    default:
      return null;
  }
}