/** Product system-prompt section for sessions with mounted knowledge bases. */
import { getSessionRecord } from '@piwin/session';
import { readMountedKnowledgeBaseNames } from './knowledge-base-service.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';

export function formatMountedKnowledgeBasePrompt(baseNames: readonly string[]): string {
  if (baseNames.length === 0) return '';
  const list = baseNames.map((name) => `- ${name}`).join('\n');
  return [
    '## Knowledge bases',
    'This session has the following knowledge bases mounted:',
    list,
    'When a question may be answered from these bases, call knowledge_search first.',
    'Cite every claim taken from the bases with [n] matching the search results.',
    'If nothing relevant is found, say "not found in the knowledge base" instead of answering from general knowledge.',
  ].join('\n');
}

export async function loadMountedKnowledgeBaseNamesForSession(
  piwinRoot: string | undefined,
  sessionId: string | undefined,
): Promise<string[]> {
  if (!sessionId) return [];
  const record = await getSessionRecord(
    getPiwinSessionIndexPath(getPiwinRoot(piwinRoot)),
    sessionId,
  );
  return readMountedKnowledgeBaseNames(piwinRoot, sessionId, record?.knowledgeBaseIds);
}
