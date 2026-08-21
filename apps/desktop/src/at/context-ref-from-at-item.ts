/**
 * `@` file/folder mentions share the same PromptContextRef path as right-click Add to Chat.
 */
import type { PromptContextRef } from '@piwin/contracts';
import type { AtItem } from './at-types.js';

export function contextRefFromAtItem(
  item: Pick<AtItem, 'kind' | 'name'>,
  projectPath: string | null | undefined,
): PromptContextRef | null {
  if (!projectPath) {
    return null;
  }
  if (item.kind !== 'file' && item.kind !== 'folder') {
    return null;
  }
  return {
    kind: item.kind,
    projectPath,
    relativePath: item.name,
    label: item.name,
  };
}
