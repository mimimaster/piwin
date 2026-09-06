import type { ToolPresentation } from '@piwin/contracts';
import { isWriteLikeToolName } from './collect-message-changed-files.js';

/**
 * Mini 「允」 stamp — proto-01 only marks write/edit rows that already ran
 * (auto / remembered / yolo). Shell/bash is not stamped; reads/searches neither.
 */
export function shouldShowApprovedSeal(tool: {
  status: 'running' | 'done' | 'error';
  toolName: string;
  presentation?: ToolPresentation | undefined;
}): boolean {
  if (tool.status !== 'done') {
    return false;
  }
  return isWriteLikeToolName(tool.toolName, tool.presentation);
}
