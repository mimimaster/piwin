/** Accessible copy for the 16,384px runtime overflow shell. Not a dialog. */
export function artifactOverflowHintCopy(locale: 'zh-CN' | 'en'): string {
  return locale === 'zh-CN'
    ? '内容高度超过 16,384px，已改为可滚动预览，滚动即可到达末尾。'
    : 'This artifact is taller than 16,384px. Scroll inside the preview to reach the end.';
}
