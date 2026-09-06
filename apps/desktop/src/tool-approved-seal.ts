import type { ToolPresentation } from '@piwin/contracts';
import { isWriteLikeToolName } from './collect-message-changed-files.js';

/**
 * Mini 「允」 stamp — proto-00 marks permission-gated work that already
 * ran (auto / remembered / yolo). Reads and searches are not 授权.
 */
export function shouldShowApprovedSeal(tool: {
  status: 'running' | 'done' | 'error';
  toolName: string;
  presentation?: ToolPresentation | undefined;
}): boolean {
  if (tool.status !== 'done') {
    return false;
  }
  if (isWriteLikeToolName(tool.toolName, tool.presentation)) {
    return true;
  }
  if (tool.presentation?.kind === 'shell') {
    return true;
  }
  const name = tool.toolName.trim().toLowerCase();
  return name === 'bash' || name === 'shell' || name === 'exec' || name.includes('bash');
}
