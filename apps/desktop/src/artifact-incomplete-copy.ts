/** A settled open fence has source, but cannot promise a working preview. */
export function artifactIncompleteCopy(locale: 'zh-CN' | 'en'): string {
  return locale === 'zh-CN'
    ? '源码不完整：代码围栏未闭合，预览不可用。'
    : 'Source incomplete: the code fence was never closed. Preview is unavailable.';
}
