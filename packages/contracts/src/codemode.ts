/**
 * Default-enabled read-only Codemode config (ADR 0087).
 *
 * Explicit false is an operator rollback override. Omitted, malformed, or
 * out-of-range values use defaults without widening a limit past its hard cap.
 */

export const CODEMODE_TOOL_NAME = 'piwin_codemode';

export const CODEMODE_TIMEOUT_MS = { default: 30_000, min: 1, max: 120_000 } as const;
export const CODEMODE_MEMORY_LIMIT_BYTES = {
  default: 64 * 1024 * 1024,
  min: 1_048_576,
  max: 256 * 1024 * 1024,
} as const;
export const CODEMODE_MAX_CALLS = { default: 32, min: 1, max: 128 } as const;
export const CODEMODE_MAX_CONCURRENCY = { default: 4, min: 1, max: 8 } as const;
export const CODEMODE_MAX_OUTPUT_CHARS = { default: 16_000, min: 256, max: 32_000 } as const;
export const CODEMODE_MAX_TOOLS = { default: 32, min: 1, max: 64 } as const;

export type CodemodeConfig = {
  /** Enabled by default; explicit false removes the tool for operator rollback. */
  enabled: boolean;
  /** Hard deadline for one script, including nested tool time. */
  timeoutMs: number;
  /** QuickJS heap cap. Allocations beyond it fail inside the script. */
  memoryLimitBytes: number;
  /** Nested Host/MCP calls one script may start. */
  maxCalls: number;
  /** Nested calls allowed to be in flight at once. */
  maxConcurrency: number;
  /** Model-facing script output cap. Nested payloads are not copied here. */
  maxOutputChars: number;
  /** Admitted read-only Host tools one script may call, excluding the toolbox shell. */
  maxTools: number;
};

export type CodemodeConfigIssue = {
  path: string;
  message: string;
};

export type ScriptReadonlyInvocation = {
  kind: 'script-readonly';
  parentToolCallId: string;
  /**
   * Host-built allowlist for this invocation. A model argument cannot supply
   * or widen it. Names outside the list are denied at dispatch.
   */
  admittedToolNames: readonly string[];
};

const LIMITS = {
  timeoutMs: CODEMODE_TIMEOUT_MS,
  memoryLimitBytes: CODEMODE_MEMORY_LIMIT_BYTES,
  maxCalls: CODEMODE_MAX_CALLS,
  maxConcurrency: CODEMODE_MAX_CONCURRENCY,
  maxOutputChars: CODEMODE_MAX_OUTPUT_CHARS,
  maxTools: CODEMODE_MAX_TOOLS,
} as const;

export function createDefaultCodemodeConfig(): CodemodeConfig {
  return {
    enabled: true,
    timeoutMs: CODEMODE_TIMEOUT_MS.default,
    memoryLimitBytes: CODEMODE_MEMORY_LIMIT_BYTES.default,
    maxCalls: CODEMODE_MAX_CALLS.default,
    maxConcurrency: CODEMODE_MAX_CONCURRENCY.default,
    maxOutputChars: CODEMODE_MAX_OUTPUT_CHARS.default,
    maxTools: CODEMODE_MAX_TOOLS.default,
  };
}

export function normalizeCodemodeConfig(value: unknown): CodemodeConfig {
  const defaults = createDefaultCodemodeConfig();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaults;
  }
  const record = value as Record<string, unknown>;
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled,
    timeoutMs: clampInteger(record.timeoutMs, LIMITS.timeoutMs, defaults.timeoutMs),
    memoryLimitBytes: clampInteger(
      record.memoryLimitBytes,
      LIMITS.memoryLimitBytes,
      defaults.memoryLimitBytes,
    ),
    maxCalls: clampInteger(record.maxCalls, LIMITS.maxCalls, defaults.maxCalls),
    maxConcurrency: clampInteger(
      record.maxConcurrency,
      LIMITS.maxConcurrency,
      defaults.maxConcurrency,
    ),
    maxOutputChars: clampInteger(
      record.maxOutputChars,
      LIMITS.maxOutputChars,
      defaults.maxOutputChars,
    ),
    maxTools: clampInteger(record.maxTools, LIMITS.maxTools, defaults.maxTools),
  };
}

/** Report unusable values; normalization uses defaults without widening limits. */
export function validateCodemodeConfig(value: unknown): CodemodeConfigIssue[] {
  if (value === undefined) {
    return [];
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [{ path: 'codemode', message: 'codemode must be an object' }];
  }
  const record = value as Record<string, unknown>;
  const issues: CodemodeConfigIssue[] = [];
  if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
    issues.push({ path: 'codemode.enabled', message: 'enabled must be a boolean' });
  }
  for (const key of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
    const raw = record[key];
    if (raw === undefined) {
      continue;
    }
    const bounds = LIMITS[key];
    if (!isSafeInteger(raw) || raw < bounds.min || raw > bounds.max) {
      issues.push({
        path: `codemode.${key}`,
        message: `${key} must be an integer from ${bounds.min} to ${bounds.max}`,
      });
    }
  }
  return issues;
}

function clampInteger(
  value: unknown,
  bounds: { readonly min: number; readonly max: number },
  fallback: number,
): number {
  if (!isSafeInteger(value) || value < bounds.min || value > bounds.max) {
    return fallback;
  }
  return value;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
