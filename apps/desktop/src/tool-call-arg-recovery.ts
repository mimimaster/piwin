/**
 * Recover path / command / line range / edit stats from Host `inputPreview`
 * when presentation dropped nested or JSON-string args.
 */

const INPUT_PREVIEW_PATH_KEYS = [
  'path',
  'file',
  'file_path',
  'filename',
  'filepath',
  'filePath',
  'target',
  'target_file',
  'targetFile',
] as const;

export type RecoveredToolArgs = {
  paths: string[];
  command: string | undefined;
  lineRange: string | undefined;
  diffStats: { added: number; removed: number } | undefined;
};

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split('\n').length;
}

export function formatReadLineRange(record: Record<string, unknown>): string | undefined {
  const start = readNumber(record.StartLine ?? record.startLine ?? record.start_line);
  const end = readNumber(record.EndLine ?? record.endLine ?? record.end_line);
  const offset = readNumber(record.offset ?? record.line_offset);
  const limit = readNumber(record.limit ?? record.line_limit ?? record.lines);
  if (start !== undefined && end !== undefined) {
    return `L${start}-${end}`;
  }
  if (start !== undefined) {
    return `L${start}`;
  }
  if (offset !== undefined) {
    const from = offset < 1 ? 1 : offset;
    if (limit !== undefined && limit > 0) {
      return `L${from}-${from + limit - 1}`;
    }
    return `L${from}`;
  }
  return undefined;
}

export function formatEditDiffStats(
  record: Record<string, unknown>,
): { added: number; removed: number } | undefined {
  const oldText =
    readString(record.old_string) ?? readString(record.oldString) ?? readString(record.old_str);
  const newText =
    readString(record.new_string) ??
    readString(record.newString) ??
    readString(record.new_str) ??
    readString(record.contents) ??
    readString(record.content);
  if (oldText !== undefined && newText !== undefined) {
    return { added: countLines(newText), removed: countLines(oldText) };
  }
  if (newText !== undefined) {
    return { added: countLines(newText), removed: 0 };
  }
  return undefined;
}

function recoverPathsFromPartialJson(text: string): string[] {
  const paths: string[] = [];
  for (const key of INPUT_PREVIEW_PATH_KEYS) {
    const match = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(text);
    const captured = match?.[1];
    if (captured && captured.trim()) {
      paths.push(captured.replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    }
  }
  return paths;
}

export function recoverToolArgsFromInputPreview(inputPreview: string | undefined): RecoveredToolArgs {
  const empty: RecoveredToolArgs = {
    paths: [],
    command: undefined,
    lineRange: undefined,
    diffStats: undefined,
  };
  if (!inputPreview) {
    return empty;
  }
  const trimmed = inputPreview.trim();
  if (!trimmed.startsWith('{')) {
    return empty;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return empty;
    }
    const record = parsed as Record<string, unknown>;
    const paths: string[] = [];
    for (const key of INPUT_PREVIEW_PATH_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        paths.push(value.trim());
      }
    }
    const commandCandidate = record.command ?? record.cmd ?? record.script;
    const command =
      typeof commandCandidate === 'string' && commandCandidate.trim()
        ? commandCandidate.trim()
        : undefined;
    return {
      paths,
      command,
      lineRange: formatReadLineRange(record),
      diffStats: formatEditDiffStats(record),
    };
  } catch {
    return {
      ...empty,
      paths: recoverPathsFromPartialJson(trimmed),
    };
  }
}
