import type { ToolResult, ToolResultImage } from '@piwin/contracts';

/** Keep MCP screenshots on the native image channel for both Host call paths. */
export function normalizeMcpToolResult(
  result: unknown,
): Pick<Extract<ToolResult, { ok: true }>, 'output' | 'images'> {
  const images: ToolResultImage[] = [];
  for (const part of readContent(result)) {
    if (!isRecord(part) || part.type !== 'image') continue;
    if (typeof part.mimeType !== 'string' || typeof part.data !== 'string') continue;
    const mimeType = part.mimeType.trim().toLowerCase();
    const dataBase64 = part.data.trim();
    if (!mimeType.startsWith('image/') || !dataBase64 || dataBase64.includes(',')) continue;
    images.push({ mimeType, dataBase64 });
  }
  return {
    output: formatMcpCallResult(result),
    ...(images.length > 0 ? { images } : {}),
  };
}

/** Readable text projection; binary image data must never enter text context. */
export function formatMcpCallResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return String(result ?? '');
  const content = readContent(result);
  const texts = content.flatMap((part) =>
    isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : [],
  );
  if (texts.length > 0) return texts.join('\n');
  // Image-only results formerly serialized base64 into the text prompt.
  if (content.some((part) => isRecord(part) && part.type === 'image')) {
    return 'MCP returned image content.';
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function readContent(result: unknown): unknown[] {
  return isRecord(result) && Array.isArray(result.content) ? result.content : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
