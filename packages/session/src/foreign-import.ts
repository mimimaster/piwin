/**
 * Parse foreign coding-agent transcripts into text turns.
 * Readers stay out of this module: no filesystem, no sqlite.
 */

export const FOREIGN_IMPORT_HARNESSES = ['claude', 'codex', 'cursor', 'opencode'] as const;

export type ForeignImportHarness = (typeof FOREIGN_IMPORT_HARNESSES)[number];

export type ForeignImportMode = 'compact' | 'strict';

export type ForeignImportTurn = {
  role: 'user' | 'assistant';
  text: string;
};

export type ForeignImportRequest = {
  harness: ForeignImportHarness;
  mode: ForeignImportMode;
  turns: number;
  /** Empty means list, not import. */
  target: string;
};

export const FOREIGN_IMPORT_DEFAULT_TURNS = 60;
export const FOREIGN_IMPORT_MAX_TURNS = 400;
const TURN_TEXT_MAX = 8_000;
const TOOL_TEXT_MAX = 2_000;

const COMMAND_NAMES: Record<string, ForeignImportHarness> = {
  'resume-claude': 'claude',
  'resume-codex': 'codex',
  'resume-cursor': 'cursor',
  'resume-opencode': 'opencode',
};

const SECRET_PATTERN =
  /Bearer\s+[A-Za-z0-9._~+/-]{8,}|sk-[A-Za-z0-9]{8,}|api[_-]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+/gi;

const WRAPPER_PATTERNS: readonly RegExp[] = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
  /<task-notification>[\s\S]*?<\/task-notification>/gi,
  /<turn_aborted>[\s\S]*?<\/turn_aborted>/gi,
  /<recommended_plugins>[\s\S]*?<\/recommended_plugins>/gi,
  /\[Request interrupted by user[^\]]*\]/gi,
];

export function matchForeignImportPrompt(text: string): ForeignImportRequest | null {
  const trimmed = text.trim();
  const match = /^\/(resume-claude|resume-codex|resume-cursor|resume-opencode)(?:\s+([\s\S]*))?$/.exec(
    trimmed,
  );
  if (!match?.[1]) return null;
  const harness = COMMAND_NAMES[match[1]];
  if (!harness) return null;
  return parseForeignImportArgs(harness, match[2] ?? '');
}

export function parseForeignImportArgs(
  harness: ForeignImportHarness,
  rawArgs: string,
): ForeignImportRequest {
  const tokens = rawArgs.trim().split(/\s+/).filter((token) => token.length > 0);
  let mode: ForeignImportMode = 'compact';
  let turns = FOREIGN_IMPORT_DEFAULT_TURNS;
  const targetParts: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (token === '--mode') {
      const value = tokens[index + 1];
      if (value === 'strict' || value === 'compact') {
        mode = value;
        index += 1;
      }
      continue;
    }
    if (token === '--turns') {
      const value = Number(tokens[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        turns = Math.min(FOREIGN_IMPORT_MAX_TURNS, Math.floor(value));
        index += 1;
      }
      continue;
    }
    targetParts.push(token);
  }
  return { harness, mode, turns, target: targetParts.join(' ') };
}

export function parseForeignTranscript(
  harness: ForeignImportHarness,
  raw: string,
  mode: ForeignImportMode,
): ForeignImportTurn[] {
  if (harness === 'codex') return parseCodexJsonl(raw, mode);
  if (harness === 'cursor') return parseCursorTranscript(raw, mode);
  return parseClaudeLikeJsonl(raw, mode);
}

export function limitForeignTurns(
  turns: readonly ForeignImportTurn[],
  maxTurns: number,
): { turns: ForeignImportTurn[]; omitted: number } {
  const cap = Math.min(FOREIGN_IMPORT_MAX_TURNS, Math.max(1, Math.floor(maxTurns)));
  if (turns.length <= cap) return { turns: [...turns], omitted: 0 };
  return { turns: turns.slice(turns.length - cap), omitted: turns.length - cap };
}

export function foreignSessionTitle(turns: readonly ForeignImportTurn[], fallback: string): string {
  const firstUser = turns.find((turn) => turn.role === 'user' && turn.text.trim().length > 0);
  const source = firstUser?.text ?? fallback;
  const line = source.replace(/\s+/g, ' ').trim();
  if (!line) return fallback;
  return line.length > 72 ? `${line.slice(0, 69)}...` : line;
}

function parseClaudeLikeJsonl(raw: string, mode: ForeignImportMode): ForeignImportTurn[] {
  const turns: ForeignImportTurn[] = [];
  for (const record of jsonlRecords(raw)) {
    const role = readRole(record);
    if (role !== 'user' && role !== 'assistant') continue;
    const text = textFromContent(record.message ?? record.content ?? record, mode);
    pushTurn(turns, role, text);
  }
  return turns;
}

function parseCodexJsonl(raw: string, mode: ForeignImportMode): ForeignImportTurn[] {
  const turns: ForeignImportTurn[] = [];
  for (const record of jsonlRecords(raw)) {
    const payload = asRecord(record.payload) ?? record;
    const payloadType = typeof payload.type === 'string' ? payload.type : '';
    if (payloadType === 'user_message' && typeof payload.message === 'string') {
      pushTurn(turns, 'user', payload.message);
      continue;
    }
    const role = readRole(payload) ?? readRole(record);
    if (role !== 'user' && role !== 'assistant') continue;
    const text = textFromContent(payload.content ?? payload.message ?? payload, mode);
    pushTurn(turns, role, text);
  }
  return turns;
}

function parseCursorTranscript(raw: string, mode: ForeignImportMode): ForeignImportTurn[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return turnsFromRecords(parsed.filter(isRecord), mode);
      }
    } catch {
      return [];
    }
  }
  return turnsFromRecords(jsonlRecords(raw), mode);
}

function turnsFromRecords(
  records: readonly Record<string, unknown>[],
  mode: ForeignImportMode,
): ForeignImportTurn[] {
  const turns: ForeignImportTurn[] = [];
  for (const record of records) {
    const role = readRole(record) ?? readRole(asRecord(record.message) ?? {});
    if (role !== 'user' && role !== 'assistant') continue;
    const text = textFromContent(record.message ?? record.content ?? record.text ?? record, mode);
    pushTurn(turns, role, text);
  }
  return turns;
}

function pushTurn(
  turns: ForeignImportTurn[],
  role: 'user' | 'assistant',
  text: string,
): void {
  const cleaned = clip(redactSecrets(stripWrappers(text)));
  if (!cleaned) return;
  const previous = turns[turns.length - 1];
  if (previous && previous.role === role && previous.text === cleaned) return;
  turns.push({ role, text: cleaned });
}

function textFromContent(value: unknown, mode: ForeignImportMode): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => textFromPart(part, mode))
      .filter((part) => part.length > 0)
      .join('\n');
  }
  const record = asRecord(value);
  if (!record) return '';
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string' || Array.isArray(record.content)) {
    return textFromContent(record.content, mode);
  }
  return '';
}

function textFromPart(part: unknown, mode: ForeignImportMode): string {
  if (typeof part === 'string') return part;
  const record = asRecord(part);
  if (!record) return '';
  const type = typeof record.type === 'string' ? record.type : '';
  if (type === 'text' || type === 'input_text' || type === 'output_text') {
    return typeof record.text === 'string' ? record.text : '';
  }
  if (mode !== 'strict') return '';
  if (type === 'tool_use' || type === 'tool_call') {
    const name = typeof record.name === 'string' ? record.name : 'tool';
    const input = clipTool(stableJson(record.input ?? record.arguments ?? ''));
    return `[tool ${name}]\n${input}`;
  }
  if (type === 'tool_result' || type === 'tool_result_error') {
    const body = textFromContent(record.content ?? record.output ?? record.text, 'compact');
    return `[tool result]\n${clipTool(body)}`;
  }
  return '';
}

function jsonlRecords(raw: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) records.push(parsed);
    } catch {
      // Skip a corrupt line rather than failing the whole file.
    }
  }
  return records;
}

function stripWrappers(text: string): string {
  let next = text;
  for (const pattern of WRAPPER_PATTERNS) {
    next = next.replace(pattern, '');
  }
  return next.replace(/^# AGENTS\.md instructions[\s\S]*?(?:\n{2}|$)/m, '');
}

function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, '[redacted]');
}

function clip(text: string): string {
  const trimmed = text.replace(/\n{3,}/g, '\n\n').trim();
  if (trimmed.length <= TURN_TEXT_MAX) return trimmed;
  return `${trimmed.slice(0, TURN_TEXT_MAX)}\n[truncated]`;
}

function clipTool(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= TOOL_TEXT_MAX) return trimmed;
  return `${trimmed.slice(0, TOOL_TEXT_MAX)}…`;
}

function readRole(record: Record<string, unknown>): 'user' | 'assistant' | undefined {
  const direct = record.role;
  if (direct === 'user' || direct === 'assistant') return direct;
  const message = asRecord(record.message);
  const nested = message?.role;
  if (nested === 'user' || nested === 'assistant') return nested;
  return undefined;
}

function stableJson(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
