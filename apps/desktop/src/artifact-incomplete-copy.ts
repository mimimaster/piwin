/**
 * Special-token delimiters some models (DeepSeek's `<｜DSML｜…>`, `<|tool_call|>`)
 * leak into text when a compatible channel does not parse their native tool
 * calls. Seeing one explains *why* the fence never closed.
 */
const LEAKED_TOOL_CALL_MARKUP = /<\/?\s*[｜|][^<>\n]{0,64}[｜|]/u;

export function hasLeakedToolCallMarkup(source: string): boolean {
  return LEAKED_TOOL_CALL_MARKUP.test(source);
}

/** A settled open fence may preview partially, but cannot promise working behavior. */
export function artifactIncompleteCopy(locale: 'zh-CN' | 'en', source: string): string {
  const leaked = hasLeakedToolCallMarkup(source);
  if (locale === 'zh-CN') {
    return leaked
      ? '输出未完成：模型输出了无法解析的工具调用标记，预览可能不全'
      : '输出未完成，预览可能不全';
  }
  return leaked
    ? 'Output incomplete: the model emitted unparseable tool-call markup; preview may be partial'
    : 'Output incomplete; preview may be partial';
}
