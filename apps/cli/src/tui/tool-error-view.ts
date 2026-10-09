import type { ToolErrorView } from '@piwin/contracts';

/**
 * A failed tool call in the reader's words. Permission refusals are the common
 * case and carry policy codes meant for the model (`chain-ask:ask-all-no-match`);
 * the category says what happened, so the text is not parsed beyond one
 * boundary reason. Other failures keep the Host's message, which names the cause.
 */
export function describeToolError(error: ToolErrorView): string {
  if (error.category === 'permission') {
    return error.message.includes('outside this session') || error.message.includes('path-escapes-project-root')
      ? '没有获得许可：路径在项目目录之外，没有执行'
      : '没有获得许可，没有执行';
  }
  if (error.category === 'cancelled') return '已取消';
  return error.message;
}
