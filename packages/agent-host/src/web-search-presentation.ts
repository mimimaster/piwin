import { readWebSearchDiagnostics, type ToolPresentation } from '@piwin/contracts';

const WEB_SEARCH_TOOL_NAME = 'web_search';

/**
 * Attach per-source `web_search` diagnostics so shells can show which sources
 * failed or were slow without parsing model-facing JSON.
 */
export function attachWebSearchPresentation(
  presentation: ToolPresentation,
  input: { toolName: string; routedToolName?: string; details?: unknown },
): ToolPresentation {
  if (input.toolName !== WEB_SEARCH_TOOL_NAME && input.routedToolName !== WEB_SEARCH_TOOL_NAME) {
    return presentation;
  }
  const webSearch = readWebSearchDiagnostics(input.details);
  if (!webSearch) return presentation;
  return { ...presentation, webSearch };
}
