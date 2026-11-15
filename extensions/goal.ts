/**
 * Autonomous goal execution loop and tracking extension (@narumitw/pi-goal).
 * @piwin-bundled-extension
 * @piwin-bundled-version 2
 *
 * Loaded by Pi jiti as a product extension under ~/.piwin/extensions.
 * Disable via config.extensions.disabledIds: ["goal"].
 */

export type GoalCompleteInput = {
  summary: string;
  verification?: string;
  artifacts?: string[];
};

export type GoalBlockedInput = {
  reason: string;
  unblockAction?: string;
};

export type GoalWaitInput = {
  reason: string;
  durationSeconds?: number;
};

export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'boolean' | 'number';
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
  minItems?: number;
  minLength?: number;
};

export type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: JsonSchema;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    context?: unknown,
  ) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    details?: Record<string, unknown>;
  }>;
};

export type ExtensionApi = {
  registerTool?: (tool: RegisteredTool) => void;
  registerCommand?: (command: {
    name: string;
    description: string;
    callback: (args: string, ctx: unknown) => Promise<void> | void;
  }) => void;
  on?: (event: string, handler: (...args: unknown[]) => unknown) => void;
};

/** The slice of Pi's ExtensionUIContext this extension uses (piwin ADR 0080). */
type GoalUi = {
  notify?: (message: string, level?: 'info' | 'warning' | 'error') => void;
  setWorkingMessage?: (message?: string) => void;
};

/** Longest toast text; the full summary stays in the tool card. */
const NOTICE_MAX_CHARS = 160;
/** Upper bound of one goal_wait, as before. */
const WAIT_MAX_MS = 30_000;

/**
 * Pi passes the extension context as the tool's fifth argument. Reading `ui`
 * can throw once the runner is gone, and headless hosts have no UI; either way
 * the tool still works, it just shows nothing.
 */
function readGoalUi(context: unknown): GoalUi | undefined {
  try {
    if (!context || typeof context !== 'object') return undefined;
    const ctx = context as { hasUI?: boolean; ui?: unknown };
    if (ctx.hasUI === false || !ctx.ui || typeof ctx.ui !== 'object') return undefined;
    return ctx.ui as GoalUi;
  } catch {
    return undefined;
  }
}

function notifyGoal(ui: GoalUi | undefined, message: string, level: 'info' | 'warning'): void {
  try {
    ui?.notify?.(truncate(message, NOTICE_MAX_CHARS), level);
  } catch {
    // Display is best-effort; the tool result is the record.
  }
}

function setGoalWorking(ui: GoalUi | undefined, message?: string): void {
  try {
    ui?.setWorkingMessage?.(message);
  } catch {
    // Display is best-effort.
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Sleep in one-second steps, reporting the remaining seconds; stops on abort. */
async function waitWithCountdown(
  totalMs: number,
  signal: AbortSignal | undefined,
  onTick: (remainingSeconds: number) => void,
): Promise<void> {
  const deadline = Date.now() + totalMs;
  while (!signal?.aborted) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return;
    onTick(Math.ceil(remainingMs / 1000));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, Math.min(1000, remainingMs));
      function done(): void {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        resolve();
      }
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}

export const GOAL_COMPLETE_PARAMETERS: JsonSchema = {
  type: 'object',
  required: ['summary'],
  properties: {
    summary: {
      type: 'string',
      description: 'Detailed summary of what was accomplished and how acceptance criteria were met.',
      minLength: 1,
    },
    verification: {
      type: 'string',
      description: 'Evidence of verification (e.g. test command output, lint results, build output).',
    },
    artifacts: {
      type: 'array',
      description: 'List of paths to modified, created, or relevant output files.',
      items: { type: 'string' },
    },
  },
};

export const GOAL_BLOCKED_PARAMETERS: JsonSchema = {
  type: 'object',
  required: ['reason'],
  properties: {
    reason: {
      type: 'string',
      description: 'Specific explanation of the blocker, ambiguity, or required user decision.',
      minLength: 1,
    },
    unblockAction: {
      type: 'string',
      description: 'Recommended action or input needed from the user to unblock progress.',
    },
  },
};

export const GOAL_WAIT_PARAMETERS: JsonSchema = {
  type: 'object',
  required: ['reason'],
  properties: {
    reason: {
      type: 'string',
      description: 'Reason for waiting (e.g. external async job, server spin-up).',
      minLength: 1,
    },
    durationSeconds: {
      type: 'number',
      description: 'Optional wait duration in seconds.',
    },
  },
};

export default function goalExtension(pi: ExtensionApi): void {
  if (typeof pi.registerTool === 'function') {
    pi.registerTool({
      name: 'goal_complete',
      label: 'Goal Complete',
      description:
        'Declare that the current objective and acceptance criteria have been verified and accomplished.',
      parameters: GOAL_COMPLETE_PARAMETERS,
      execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
        const input = (params && typeof params === 'object' ? params : {}) as GoalCompleteInput;
        const summary = typeof input.summary === 'string' ? input.summary.trim() : 'Goal complete';
        const verification =
          typeof input.verification === 'string' ? input.verification.trim() : '';
        const artifacts = Array.isArray(input.artifacts)
          ? input.artifacts.filter((a): a is string => typeof a === 'string')
          : [];

        notifyGoal(readGoalUi(context), `🎯 ${summary}`, 'info');

        const lines = [`🎯 Goal Complete: ${summary}`];
        if (verification) {
          lines.push(`\nVerification Evidence:\n${verification}`);
        }
        if (artifacts.length > 0) {
          lines.push(`\nArtifacts:\n${artifacts.map((a) => `- ${a}`).join('\n')}`);
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: {
            status: 'completed',
            summary,
            verification,
            artifacts,
          },
        };
      },
    });

    pi.registerTool({
      name: 'goal_blocked',
      label: 'Goal Blocked',
      description:
        'Signal that progress is blocked by an impasse, ambiguity, or missing user decision.',
      parameters: GOAL_BLOCKED_PARAMETERS,
      execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
        const input = (params && typeof params === 'object' ? params : {}) as GoalBlockedInput;
        const reason =
          typeof input.reason === 'string' ? input.reason.trim() : 'Goal is blocked';
        const unblockAction =
          typeof input.unblockAction === 'string' ? input.unblockAction.trim() : '';

        // Blocked means the user must act, so it is a warning, not a status.
        notifyGoal(
          readGoalUi(context),
          unblockAction ? `⚠️ ${reason} → ${unblockAction}` : `⚠️ ${reason}`,
          'warning',
        );

        const lines = [`⚠️ Goal Blocked: ${reason}`];
        if (unblockAction) {
          lines.push(`\nAction needed to unblock: ${unblockAction}`);
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: {
            status: 'blocked',
            reason,
            unblockAction,
          },
        };
      },
    });

    pi.registerTool({
      name: 'goal_wait',
      label: 'Goal Wait',
      description: 'Wait for an external condition or async process.',
      parameters: GOAL_WAIT_PARAMETERS,
      execute: async (_toolCallId, params, signal, _onUpdate, context) => {
        const input = (params && typeof params === 'object' ? params : {}) as GoalWaitInput;
        const reason = typeof input.reason === 'string' ? input.reason.trim() : 'Waiting';
        const duration =
          typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds)
            ? input.durationSeconds
            : 0;

        if (duration > 0) {
          const ui = readGoalUi(context);
          const label = truncate(reason, 80);
          try {
            await waitWithCountdown(Math.min(duration * 1000, WAIT_MAX_MS), signal, (seconds) =>
              setGoalWorking(ui, `⏸ ${label} · ${seconds}s`),
            );
          } finally {
            setGoalWorking(ui, undefined);
          }
        }

        return {
          content: [{ type: 'text', text: `⏸️ Waited: ${reason}` }],
          details: {
            status: 'waited',
            reason,
            durationSeconds: duration,
          },
        };
      },
    });
  }
}
