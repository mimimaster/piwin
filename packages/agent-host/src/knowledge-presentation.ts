import {
  KNOWLEDGE_TOOL_NAMES,
  readKnowledgeToolDetails,
  type ToolPresentation,
} from '@piwin/contracts';

const KNOWLEDGE_CITING_TOOLS: ReadonlySet<string> = new Set([
  KNOWLEDGE_TOOL_NAMES.search,
  KNOWLEDGE_TOOL_NAMES.read,
]);

function isKnowledgeCitingTool(name: string | undefined): boolean {
  return name !== undefined && KNOWLEDGE_CITING_TOOLS.has(name);
}

/**
 * Attach knowledge citations from a `knowledge_search` / `knowledge_read`
 * result so shells can resolve `[n]` markers without parsing model-facing text.
 */
export function attachKnowledgePresentation(
  presentation: ToolPresentation,
  input: { toolName: string; routedToolName?: string; details?: unknown },
): ToolPresentation {
  if (!isKnowledgeCitingTool(input.toolName) && !isKnowledgeCitingTool(input.routedToolName)) {
    return presentation;
  }
  const knowledge = readKnowledgeToolDetails(input.details);
  if (!knowledge) return presentation;
  return { ...presentation, knowledge };
}
