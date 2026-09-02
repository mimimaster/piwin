import type { ToolOutputTruncation } from '@piwin/contracts';
import { asRecord } from './pi-event-read.js';
import { coerceToolArgs } from './tool-presentation.js';

/** Convert Pi's result details into the display-safe truncation contract. */
export function normalizeToolOutputTruncation(
  details: unknown,
  args: unknown,
  toolName: string,
): ToolOutputTruncation | undefined {
  const detailsRecord = asRecord(details);
  const nativeTruncation = asRecord(detailsRecord?.truncation);
  if (nativeTruncation?.truncated !== true) {
    return undefined;
  }

  const maxLines = readPositiveInteger(nativeTruncation.maxLines);
  const maxBytes = readPositiveInteger(nativeTruncation.maxBytes);
  const totalLines = readPositiveInteger(nativeTruncation.totalLines);
  const outputLines = readNonNegativeInteger(nativeTruncation.outputLines);
  const firstLineExceedsLimit = nativeTruncation.firstLineExceedsLimit === true;
  const reason = nativeTruncation.truncatedBy === 'lines' ? 'line-limit' : 'byte-limit';
  const normalizedArgs = coerceToolArgs(args);
  const readStartLine =
    toolName.trim().toLowerCase() === 'read' ? readReadStartLine(normalizedArgs) : undefined;
  const shownLines =
    readStartLine !== undefined && outputLines !== undefined && outputLines > 0
      ? { start: readStartLine, end: readStartLine + outputLines - 1 }
      : undefined;
  const nextOffset = shownLines === undefined ? undefined : shownLines.end + 1;

  return {
    reason,
    ...(shownLines !== undefined ? { shownLines } : {}),
    ...(totalLines !== undefined ? { totalLines } : {}),
    ...(nextOffset !== undefined ? { nextOffset } : {}),
    ...(maxLines !== undefined ? { limitLines: maxLines } : {}),
    ...(maxBytes !== undefined ? { limitBytes: maxBytes } : {}),
    ...(firstLineExceedsLimit ? { firstLineExceedsLimit: true } : {}),
  };
}

function readReadStartLine(args: unknown): number {
  const record = asRecord(args);
  const offset = readPositiveInteger(record?.offset ?? record?.line_offset);
  return offset === undefined ? 1 : Math.max(1, offset);
}

function readPositiveInteger(value: unknown): number | undefined {
  const number = readFiniteNumber(value);
  return number !== undefined && number > 0 ? Math.floor(number) : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  const number = readFiniteNumber(value);
  return number !== undefined && number >= 0 ? Math.floor(number) : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
