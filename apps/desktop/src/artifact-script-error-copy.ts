/**
 * One line naming a script failure inside an artifact sandbox.
 *
 * Without it the only thing on screen is whatever fallback markup the author
 * left behind — often "enable JavaScript" — which reads as the platform
 * blocking scripts. Scripts are allowed (`sandbox="allow-scripts"` plus
 * `script-src 'unsafe-inline'`); this says the document's own code failed.
 *
 * Every field comes from untrusted HTML. Callers render the result as text.
 */
import type { ArtifactErrorMessage } from '@piwin/artifact';

export function artifactScriptErrorCopy(
  error: ArtifactErrorMessage,
  locale: 'zh-CN' | 'en',
): string {
  const isChinese = locale === 'zh-CN';
  const lead = isChinese
    ? error.kind === 'rejection'
      ? '脚本有未处理的异常'
      : '脚本未运行完成'
    : error.kind === 'rejection'
      ? 'Unhandled rejection in this artifact'
      : 'This artifact’s script failed';
  const detail = error.name ? `${error.name}: ${error.message}` : error.message;
  const at =
    error.line === undefined
      ? ''
      : isChinese
        ? `（第 ${error.line} 行${error.column === undefined ? '' : ` 第 ${error.column} 列`}）`
        : ` (line ${error.line}${error.column === undefined ? '' : `, col ${error.column}`})`;
  return `${lead} · ${detail}${at}`;
}
