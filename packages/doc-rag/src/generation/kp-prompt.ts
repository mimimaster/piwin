import type { ContextPack } from '@piwin/contracts';

export function buildKnowledgePointPrompt(input: {
  topic: string;
  workspaceName: string;
  pack: ContextPack;
}): string {
  const excerpts = input.pack.sources
    .map(
      (source, index) =>
        `[chunk ${source.chunkId}] (${index + 1}) ${source.relativePath}\n${source.text}`,
    )
    .join('\n\n');
  return [
    'Extract knowledge points from the passages.',
    'Do not write flashcard fronts or backs.',
    'Every sourceChunkIds value must be one of the chunk ids below.',
    'Do not invent chunk ids or facts that are not in the passages.',
    `Workspace: ${input.workspaceName}`,
    `Topic: ${input.topic}`,
    'Return JSON: { "knowledgePoints": [{ "tempId", "concept", "statement", "type", "importance", "sourceChunkIds" }] }',
    excerpts,
  ].join('\n\n');
}
