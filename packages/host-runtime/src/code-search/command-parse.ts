/**
 * Normalize a `restricted_exec` call's arguments into executable commands.
 *
 * The subagent fills `command1` … `commandN` slots (the schema offers only
 * `command1` as required). Provider models regularly emit near-misses — a
 * missing `path`, a number where a string belongs, an unknown `type` — so
 * every slot is validated here and reported per slot instead of failing the
 * whole round: one bad slot must not cost the other seven.
 */
import type { CodeSearchRestrictedCommand } from './restricted-executor.js';
import { isCodeSearchCommandType } from './tool-schema.js';

/** A slot that could not be turned into a command. */
export type CodeSearchCommandSlotError = {
  slot: string;
  message: string;
};

export type CodeSearchCommandParseResult = {
  commands: CodeSearchRestrictedCommand[];
  errors: CodeSearchCommandSlotError[];
};

const COMMAND_SLOT = /^command(\d+)$/;

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .map((item) => asNonEmptyString(item))
    .filter((item): item is string => item !== undefined);
  return items.length ? items : undefined;
}

function asInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function buildCommand(raw: Record<string, unknown>): CodeSearchRestrictedCommand | string {
  const type = raw.type;
  if (!isCodeSearchCommandType(type)) {
    return `unknown command type ${JSON.stringify(type)}`;
  }
  switch (type) {
    case 'rg': {
      const pattern = asNonEmptyString(raw.pattern);
      const path = asNonEmptyString(raw.path);
      if (!pattern) return 'rg requires a non-empty pattern';
      if (!path) return 'rg requires a non-empty path';
      const include = asStringArray(raw.include);
      const exclude = asStringArray(raw.exclude);
      return {
        type: 'rg',
        pattern,
        path,
        ...(include ? { include } : {}),
        ...(exclude ? { exclude } : {}),
      };
    }
    case 'readfile': {
      const file = asNonEmptyString(raw.file);
      if (!file) return 'readfile requires a non-empty file';
      const startLine = asInteger(raw.start_line);
      const endLine = asInteger(raw.end_line);
      return {
        type: 'readfile',
        file,
        ...(startLine !== undefined ? { start_line: startLine } : {}),
        ...(endLine !== undefined ? { end_line: endLine } : {}),
      };
    }
    case 'tree': {
      const path = asNonEmptyString(raw.path);
      if (!path) return 'tree requires a non-empty path';
      const levels = asInteger(raw.levels);
      return { type: 'tree', path, ...(levels !== undefined ? { levels } : {}) };
    }
    case 'ls': {
      const path = asNonEmptyString(raw.path);
      if (!path) return 'ls requires a non-empty path';
      const longFormat = asBoolean(raw.long_format);
      const all = asBoolean(raw.all);
      return {
        type: 'ls',
        path,
        ...(longFormat !== undefined ? { long_format: longFormat } : {}),
        ...(all !== undefined ? { all } : {}),
      };
    }
    case 'glob': {
      const pattern = asNonEmptyString(raw.pattern);
      const path = asNonEmptyString(raw.path);
      if (!pattern) return 'glob requires a non-empty pattern';
      if (!path) return 'glob requires a non-empty path';
      const filter = raw.type_filter;
      const typeFilter =
        filter === 'file' || filter === 'directory' || filter === 'all' ? filter : undefined;
      return {
        type: 'glob',
        pattern,
        path,
        ...(typeFilter ? { type_filter: typeFilter } : {}),
      };
    }
    default:
      return `unknown command type ${JSON.stringify(type)}`;
  }
}

/**
 * Turn `restricted_exec` arguments into commands in slot order, capped at
 * `maxCommands`. Slots are visited in numeric order rather than key order so a
 * model that emits `command2` before `command1` still runs them in intent order.
 */
export function parseRestrictedExecArguments(
  args: Record<string, unknown>,
  maxCommands: number,
): CodeSearchCommandParseResult {
  const slots = Object.keys(args)
    .map((key) => {
      const match = COMMAND_SLOT.exec(key);
      return match ? { key, index: Number.parseInt(match[1] ?? '', 10) } : undefined;
    })
    .filter((slot): slot is { key: string; index: number } => slot !== undefined)
    .sort((a, b) => a.index - b.index)
    .slice(0, Math.max(0, maxCommands));

  const commands: CodeSearchRestrictedCommand[] = [];
  const errors: CodeSearchCommandSlotError[] = [];
  for (const slot of slots) {
    const raw = args[slot.key];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push({ slot: slot.key, message: 'command must be an object' });
      continue;
    }
    const built = buildCommand(raw as Record<string, unknown>);
    if (typeof built === 'string') {
      errors.push({ slot: slot.key, message: built });
      continue;
    }
    commands.push(built);
  }
  return { commands, errors };
}

/** Render slot errors for the subagent's next turn. */
export function formatCommandSlotErrors(errors: readonly CodeSearchCommandSlotError[]): string {
  return errors.map((error) => `Error: ${error.slot}: ${error.message}`).join('\n');
}
