/** A settled open fence may preview partially, but cannot promise working behavior. */
export function artifactIncompleteCopy(locale: 'zh-CN' | 'en'): string {
  return locale === 'zh-CN'
    ? '模型输出未完成：代码围栏未闭合。以下是已生成内容的预览，部分功能可能无法运行。'
    : 'Model output is incomplete: the code fence was not closed. This previews the generated content; some features may not work.';
}
